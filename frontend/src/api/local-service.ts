import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  getResistanceRule,
  listDcReviews,
  listRows,
  resetDcReviews,
  resetRows,
  saveDcReviews,
  saveResistanceRule,
  saveRows,
} from '@/data/local-store'
import { DC_MODULE_KEY, DC_STATUSES } from '@/data/dc-domain'
import type { DcReviewItem, ResistanceRule } from '@/data/dc-domain'
import type {
  DcFacets,
  DcGroup,
  DcGroupFilter,
  DcGroupQuery,
  DcFilterCondition,
  DcRangeProblem,
} from '@/data/dc-domain'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 直流监测的动作按蓄电池组分档处理：标记异常要同步进设备巡视待复查清单。
  if (key === DC_MODULE_KEY) {
    return runDcAction(rows, index, action, target)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  if (key === DC_MODULE_KEY) {
    // 直流重置时复查清单一起回种子；内阻尺子是专责定的，重置数据不动尺子。
    resetRows(key)
    resetDcReviews()
    return listEntries(key)
  }
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    if (meta.key === DC_MODULE_KEY) {
      // 直流按组分档统计：待处理/异常只数蓄电池组，不把历史档重复算进去。
      const groups = buildDcGroups(entries)
      return {
        name: meta.name,
        created: entries.length,
        pending: groups.filter((group) => group.latest.pending).length,
        abnormal: groups.filter((group) => group.latest.abnormal).length,
      }
    }
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 直流系统监测：按蓄电池组分档的定位查询、明细、内阻尺子与巡视待复查联动
// ---------------------------------------------------------------------------

function toMetricNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
  const parsed = Number(String(value).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function dcGroupKeyOf(row: EntryRow): string {
  const stored = String(row.组分档键 ?? '').trim()
  if (stored !== '') {
    return stored
  }
  return `${String(row.所属变电站 ?? '')}|${String(row.蓄电池组号 ?? '')}`
}

/** 把扁平监测记录按蓄电池组分档，每档带出最近一次监测（日期相同取编号靠后的）。 */
export function buildDcGroups(rows: EntryRow[] = listRows(DC_MODULE_KEY)): DcGroup[] {
  const buckets = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = dcGroupKeyOf(row)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      buckets.set(key, [row])
    }
  }
  const groups: DcGroup[] = []
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort(
      (a, b) =>
        String(b.监测日期 ?? '').localeCompare(String(a.监测日期 ?? '')) || Number(b.id) - Number(a.id),
    )
    const latest = sorted[0]
    groups.push({
      groupKey: key,
      station: String(latest.所属变电站 ?? ''),
      groupNo: String(latest.蓄电池组号 ?? ''),
      latest,
      recordCount: sorted.length,
      cellVoltage: toMetricNumber(latest.单体电压),
      resistance: toMetricNumber(latest.内阻),
    })
  }
  return groups.sort((a, b) => a.station.localeCompare(b.station, 'zh-Hans-CN') || a.groupNo.localeCompare(b.groupNo))
}

/** 拉开明细：同一份分档数据按时间倒序排，首行就是列表上那一次监测。 */
export function getDcGroupHistory(groupKey: string): EntryRow[] {
  return listRows(DC_MODULE_KEY)
    .filter((row) => dcGroupKeyOf(row) === groupKey)
    .sort(
      (a, b) =>
        String(b.监测日期 ?? '').localeCompare(String(a.监测日期 ?? '')) || Number(b.id) - Number(a.id),
    )
}

export function getDcFacets(): DcFacets {
  const groups = buildDcGroups()
  const groupsByStation: DcFacets['groupsByStation'] = {}
  for (const group of groups) {
    const list = groupsByStation[group.station] ?? []
    list.push({ key: group.groupKey, label: group.groupNo })
    groupsByStation[group.station] = list
  }
  return {
    stations: [...new Set(groups.map((group) => group.station))],
    groupsByStation,
    statuses: [...DC_STATUSES],
  }
}

function parseBound(raw: string): { value: number | null; invalid: boolean } {
  const text = raw.trim()
  if (text === '') {
    return { value: null, invalid: false }
  }
  const value = Number(text)
  return { value, invalid: !Number.isFinite(value) }
}

function observedRange(groups: DcGroup[], field: 'cellVoltage' | 'resistance'): string {
  const values = groups
    .map((group) => group[field])
    .filter((value): value is number => value !== null)
  if (values.length === 0) {
    return '暂无数值记录'
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const fixed = field === 'cellVoltage' ? 2 : 3
  return `${min.toFixed(fixed)} ~ ${max.toFixed(fixed)}`
}

/** 值长定位错峰组：条件叠加过滤，零结果时逐项漏斗诊断是哪一项卡成 0。 */
export function queryDcGroups(filter: DcGroupFilter): DcGroupQuery {
  const allGroups = buildDcGroups()
  const problems: DcRangeProblem[] = []

  const voltageMin = parseBound(filter.voltageMin)
  const voltageMax = parseBound(filter.voltageMax)
  const resistanceMin = parseBound(filter.resistanceMin)
  const resistanceMax = parseBound(filter.resistanceMax)

  if (voltageMin.invalid || voltageMax.invalid) {
    problems.push({ field: 'voltage', label: '单体电压区间', message: '单体电压起/止要填数字，单位 V' })
  } else if (
    voltageMin.value !== null &&
    voltageMax.value !== null &&
    voltageMin.value > voltageMax.value
  ) {
    problems.push({ field: 'voltage', label: '单体电压区间', message: '单体电压起点不能高于止点' })
  }
  if (resistanceMin.invalid || resistanceMax.invalid) {
    problems.push({ field: 'resistance', label: '内阻区间', message: '内阻起/止要填数字，单位 mΩ' })
  } else if (
    resistanceMin.value !== null &&
    resistanceMax.value !== null &&
    resistanceMin.value > resistanceMax.value
  ) {
    problems.push({ field: 'resistance', label: '内阻区间', message: '内阻起点不能高于止点' })
  }

  const conditions: DcFilterCondition[] = []
  if (filter.station.trim() !== '') {
    const stationName = filter.station.trim()
    conditions.push({
      kind: 'station',
      label: `所属变电站 = ${stationName}`,
      value: stationName,
      test: (group) => group.station === stationName,
    })
  }
  if (filter.groupKey.trim() !== '') {
    const selectedKey = filter.groupKey.trim()
    conditions.push({
      kind: 'group',
      label: '蓄电池组号已选定',
      value: selectedKey,
      test: (group) => group.groupKey === selectedKey,
    })
  }
  if (filter.status.trim() !== '') {
    const statusName = filter.status.trim()
    conditions.push({
      kind: 'status',
      label: `直流状态 = ${statusName}`,
      value: statusName,
      test: (group) => String(group.latest.status) === statusName,
    })
  }
  if (problems.length === 0) {
    if (voltageMin.value !== null || voltageMax.value !== null) {
      const vMin = voltageMin.value
      const vMax = voltageMax.value
      conditions.push({
        kind: 'range',
        field: 'voltage',
        label: `单体电压区间（${vMin ?? '−∞'} ~ ${vMax ?? '+∞'} V）`,
        min: vMin ?? Number.NEGATIVE_INFINITY,
        max: vMax ?? Number.POSITIVE_INFINITY,
        test: (group) =>
          group.cellVoltage !== null &&
          (vMin === null || group.cellVoltage >= vMin) &&
          (vMax === null || group.cellVoltage <= vMax),
      })
    }
    if (resistanceMin.value !== null || resistanceMax.value !== null) {
      const rMin = resistanceMin.value
      const rMax = resistanceMax.value
      conditions.push({
        kind: 'range',
        field: 'resistance',
        label: `内阻区间（${rMin ?? '−∞'} ~ ${rMax ?? '+∞'} mΩ）`,
        min: rMin ?? Number.NEGATIVE_INFINITY,
        max: rMax ?? Number.POSITIVE_INFINITY,
        test: (group) =>
          group.resistance !== null &&
          (rMin === null || group.resistance >= rMin) &&
          (rMax === null || group.resistance <= rMax),
      })
    }
  }

  const blockers: DcGroupQuery['diagnosis']['blockers'] = []
  let matched = allGroups
  let stopped = false
  for (const condition of conditions) {
    const remaining = matched.filter(condition.test)
    matched = remaining
    if (remaining.length === 0) {
      stopped = true
      if (condition.kind === 'range') {
        const fieldLabel = condition.field === 'voltage' ? '单体电压' : '内阻'
        blockers.push({
          label: condition.label,
          detail: `这一档把组数卡成了 0；现有${fieldLabel}范围是 ${observedRange(allGroups, condition.field === 'voltage' ? 'cellVoltage' : 'resistance')}，请放宽起或止`,
        })
      } else {
        blockers.push({ label: condition.label, detail: '这一项单独就筛不到任何蓄电池组，请改选或留空' })
      }
      break
    }
  }

  if (!stopped && matched.length === 0 && conditions.length > 1) {
    // 漏斗在中途清零：区分「这一项单独就是 0」与「单项都有、叠在一起才 0」。
    const soloCounts = conditions.map((condition) => ({
      condition,
      count: allGroups.filter(condition.test).length,
    }))
    const emptyOne = soloCounts.find((item) => item.count === 0)
    if (emptyOne) {
      const condition = emptyOne.condition
      blockers.push({
        label: condition.label,
        detail:
          condition.kind === 'range'
            ? `光是「${condition.label}」就没有组；现有${condition.field === 'voltage' ? '单体电压' : '内阻'}范围是 ${observedRange(
                allGroups,
                condition.field === 'voltage' ? 'cellVoltage' : 'resistance',
              )}，请先放宽这一项`
            : '光是这一项就筛不到任何蓄电池组，请改选或留空',
      })
    } else {
      let smallest = soloCounts[0].condition
      let smallestCount = soloCounts[0].count
      for (const item of soloCounts.slice(1)) {
        if (item.count < smallestCount) {
          smallest = item.condition
          smallestCount = item.count
        }
      }
      blockers.push({
        label: smallest.label,
        detail: `单项都有数据、叠加后为 0；该项单独只剩 ${smallestCount} 组，组合卡得太窄，建议先放宽它`,
      })
    }
  }

  return {
    groups: matched,
    total: matched.length,
    conditions,
    diagnosis: { total: allGroups.length, problems, blockers },
  }
}

export function getResistanceRuleView(): ResistanceRule {
  return getResistanceRule()
}

export function saveResistanceRuleView(input: {
  maxMilliOhm: number
  updatedBy: string
}): ActionResult {
  if (!Number.isFinite(input.maxMilliOhm) || input.maxMilliOhm <= 0) {
    return { ok: false, message: '内阻上限要填大于 0 的数字（mΩ）' }
  }
  if (input.updatedBy.trim() === '') {
    return { ok: false, message: '请填写设定人（直流专责）' }
  }
  const now = new Date()
  const updatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  saveResistanceRule({
    maxMilliOhm: Number(input.maxMilliOhm.toFixed(3)),
    unit: 'mΩ',
    updatedBy: input.updatedBy.trim(),
    updatedAt,
  })
  return { ok: true, message: `内阻尺子已按 ${input.maxMilliOhm} mΩ 更新` }
}

function nowText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function abnormalReason(row: EntryRow, rule: ResistanceRule): string {
  const voltage = toMetricNumber(row.单体电压)
  const resistance = toMetricNumber(row.内阻)
  const reasons: string[] = []
  if (voltage !== null && voltage < 2.18) {
    reasons.push('单体电压低于浮充区间')
  }
  if (voltage !== null && voltage > 2.28) {
    reasons.push('单体电压高于浮充区间')
  }
  if (resistance !== null && resistance > rule.maxMilliOhm) {
    reasons.push(`内阻超直流专责尺子（>${rule.maxMilliOhm}${rule.unit}）`)
  }
  return reasons.length > 0 ? reasons.join('；') : '直流专责判定异常'
}

/** 标记异常：更新该组最近一次监测，并把这一组 upsert 进设备巡视待复查清单（同组不重复）。 */
function upsertDcReview(
  latest: EntryRow,
  reason: string,
): { item: DcReviewItem; created: boolean } {
  const groupKey = dcGroupKeyOf(latest)
  const items = listDcReviews()
  const existing = items.find((item) => item.groupKey === groupKey)
  const reportedAt = nowText()
  if (existing) {
    const updated: DcReviewItem = {
      ...existing,
      latestDate: String(latest.监测日期 ?? existing.latestDate),
      cellVoltage: String(latest.单体电压 ?? ''),
      resistance: String(latest.内阻 ?? ''),
      reason,
      reportedAt,
      reviewed: false,
    }
    saveDcReviews(items.map((item) => (item.groupKey === groupKey ? updated : item)))
    return { item: updated, created: false }
  }
  const nextId = items.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const created: DcReviewItem = {
    id: nextId,
    station: String(latest.所属变电站 ?? ''),
    groupNo: String(latest.蓄电池组号 ?? ''),
    groupKey,
    latestDate: String(latest.监测日期 ?? ''),
    cellVoltage: String(latest.单体电压 ?? ''),
    resistance: String(latest.内阻 ?? ''),
    reason,
    reportedAt,
    reporter: '直流系统监测',
    reviewed: false,
  }
  saveDcReviews([...items, created])
  return { item: created, created: true }
}

function runDcAction(
  rows: EntryRow[],
  index: number,
  action: string,
  target: string,
): ActionResult {
  const acted = rows[index]
  const groupKey = dcGroupKeyOf(acted)
  // 页面动作挂在该组最近一次监测这一档上，旧档不回改；同组重复上报也要落到这里走 upsert。
  const latestIndex = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter((item) => dcGroupKeyOf(item.row) === groupKey)
    .sort(
      (a, b) =>
        String(b.row.监测日期 ?? '').localeCompare(String(a.row.监测日期 ?? '')) ||
        Number(b.row.id) - Number(a.row.id),
    )[0].rowIndex

  const latest = rows[latestIndex]
  const isAbnormal = target === '异常告警'
  const updated: EntryRow = {
    ...latest,
    status: target,
    直流状态: target,
    pending: target === '待监测' || target === '监测中',
    abnormal: isAbnormal,
  }
  const next = [...rows]
  next[latestIndex] = updated
  saveRows(DC_MODULE_KEY, next)

  if (isAbnormal) {
    const reason = abnormalReason(updated, getResistanceRule())
    const { item: review, created } = upsertDcReview(updated, reason)
    const staleActed = Number(latest.id) !== Number(acted.id)
    const prefix = staleActed ? '该组最近一次监测已一并更新；' : ''
    const tail = created ? '已新进入设备巡视待复查清单' : '本就在待复查清单，已刷新数据、不会长出第二条'
    return {
      ok: true,
      message: `${prefix}蓄电池组已标记异常，${tail}，上报时间 ${review.reportedAt}`,
    }
  }
  return { ok: true, message: `蓄电池组已${action}，当前状态「${target}」` }
}

// 设备巡视页读取：异常组的待复查清单，默认只给未复查的。
export function listDcPendingReviews(includeReviewed = false): DcReviewItem[] {
  return listDcReviews()
    .filter((item) => includeReviewed || !item.reviewed)
    .sort((a, b) =>
      a.reviewed === b.reviewed
        ? b.reportedAt.localeCompare(a.reportedAt)
        : a.reviewed
          ? 1
          : -1,
    )
}

export function resolveDcReview(id: number, reviewer: string): ActionResult {
  if (reviewer.trim() === '') {
    return { ok: false, message: '请填写复查人' }
  }
  const items = listDcReviews()
  const targetItem = items.find((item) => Number(item.id) === id)
  if (!targetItem) {
    return { ok: false, message: '待复查清单里没有这一条' }
  }
  if (targetItem.reviewed) {
    return { ok: false, message: '这组蓄电池已经复查过了' }
  }
  saveDcReviews(
    items.map((item) =>
      Number(item.id) === id ? { ...item, reviewed: true, reviewer: reviewer.trim(), reviewedAt: nowText() } : item,
    ),
  )
  return { ok: true, message: `${targetItem.station} ${targetItem.groupNo} 已完成复查并移出待办` }
}
