import { listRows, saveRows } from '@/data/local-store'
import {
  listDcGroups,
  loadResistanceRuler,
  resetDcGroups,
  saveDcGroups,
  saveResistanceRuler,
} from '@/data/dc-store'
import type { ActionResult, EntryRow } from '@/data/types'
import type {
  DcFilter,
  DcGroup,
  DcGroupView,
  DcReading,
  DcStatus,
  ResistanceRuler,
} from '@/data/dc-types'

/** 直流状态流转目标，与 modules.ts 里登记的保持一致 */
const DC_ACTION_TARGET: Record<string, DcStatus> = {
  提交监测: '监测中',
  判定正常: '状态正常',
  标记异常: '异常告警',
}

export function todayText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 最近一次监测：记录按从旧到新存放，取最后一条 */
export function latestReading(group: DcGroup): DcReading | null {
  return group.readings.length ? group.readings[group.readings.length - 1] : null
}

/** 组装列表/明细共用的当前读数视图——两处单体电压取自这里，保证是同一份 */
export function toGroupView(group: DcGroup, ruler: ResistanceRuler): DcGroupView {
  const latest = latestReading(group)
  const resistance = latest ? latest.internalResistance : null
  return {
    group,
    latest,
    voltage: latest ? latest.cellVoltage : null,
    resistance,
    overRuler: resistance !== null && resistance > ruler.limit,
  }
}

export function listStationOptions(): string[] {
  return [...new Set(listDcGroups().map((group) => group.station))]
}

export function listGroupNoOptions(): string[] {
  const sorter = (a: string, b: string) => parseInt(a, 10) - parseInt(b, 10)
  return [...new Set(listDcGroups().map((group) => group.groupNo))].sort(sorter)
}

export type CriterionDiagnosis = {
  /** 条件名，用于提示「是哪一项卡得太窄」 */
  label: string
  /** 只开这一项时能命中的组数 */
  aloneCount: number
  /** 单项命中即为 0，说明就是它把路堵死了 */
  blocker: boolean
}

export type DcQueryResult = {
  items: DcGroupView[]
  total: number
  /** 零命中时的逐项归因；有命中或没有条件时为空 */
  diagnosis: CriterionDiagnosis[]
  /** 区间起止写反等硬性错误 */
  rangeError: string
}

function toBound(value: string): number | null {
  const text = value.trim()
  if (text === '') {
    return null
  }
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

type ActiveCriterion = {
  label: string
  test: (group: DcGroup) => boolean
}

function buildCriteria(filter: DcFilter): ActiveCriterion[] {
  const criteria: ActiveCriterion[] = []
  if (filter.stations.length) {
    const picked = new Set(filter.stations)
    criteria.push({
      label: `所属变电站限定在已选的 ${filter.stations.length} 个站`,
      test: (group) => picked.has(group.station),
    })
  }
  if (filter.groupNos.length) {
    const picked = new Set(filter.groupNos)
    criteria.push({
      label: `蓄电池组号限定在已选的 ${filter.groupNos.length} 个组`,
      test: (group) => picked.has(group.groupNo),
    })
  }
  if (filter.statuses.length) {
    const picked = new Set(filter.statuses)
    criteria.push({
      label: `直流状态限定在已选的 ${filter.statuses.length} 档`,
      test: (group) => picked.has(group.status),
    })
  }
  const vMin = toBound(filter.voltageMin)
  const vMax = toBound(filter.voltageMax)
  if (vMin !== null) {
    criteria.push({
      label: `单体电压 ≥ ${vMin} V`,
      test: (group) => {
        const latest = latestReading(group)
        return latest !== null && latest.cellVoltage >= vMin
      },
    })
  }
  if (vMax !== null) {
    criteria.push({
      label: `单体电压 ≤ ${vMax} V`,
      test: (group) => {
        const latest = latestReading(group)
        return latest !== null && latest.cellVoltage <= vMax
      },
    })
  }
  const rMin = toBound(filter.resistanceMin)
  const rMax = toBound(filter.resistanceMax)
  if (rMin !== null) {
    criteria.push({
      label: `内阻 ≥ ${rMin} mΩ`,
      test: (group) => {
        const latest = latestReading(group)
        return latest !== null && latest.internalResistance >= rMin
      },
    })
  }
  if (rMax !== null) {
    criteria.push({
      label: `内阻 ≤ ${rMax} mΩ`,
      test: (group) => {
        const latest = latestReading(group)
        return latest !== null && latest.internalResistance <= rMax
      },
    })
  }
  if (filter.overRulerOnly) {
    const ruler = loadResistanceRuler()
    criteria.push({
      label: `只看内阻超过专责尺子（${ruler.limit} mΩ）的组`,
      test: (group) => {
        const latest = latestReading(group)
        return latest !== null && latest.internalResistance > ruler.limit
      },
    })
  }
  return criteria
}

/** 筛选定位：多选条件叠着取交集，区间条件按起止卡门槛，返回命中组数与零命中归因 */
export function queryDcGroups(filter: DcFilter): DcQueryResult {
  const vMin = toBound(filter.voltageMin)
  const vMax = toBound(filter.voltageMax)
  const rMin = toBound(filter.resistanceMin)
  const rMax = toBound(filter.resistanceMax)
  if (vMin !== null && vMax !== null && vMin > vMax) {
    return { items: [], total: 0, diagnosis: [], rangeError: '单体电压的起始值不能大于截止值' }
  }
  if (rMin !== null && rMax !== null && rMin > rMax) {
    return { items: [], total: 0, diagnosis: [], rangeError: '内阻的起始值不能大于截止值' }
  }

  const ruler = loadResistanceRuler()
  const all = listDcGroups()
  const criteria = buildCriteria(filter)
  const matched = all.filter((group) => criteria.every((criterion) => criterion.test(group)))

  let diagnosis: CriterionDiagnosis[] = []
  if (matched.length === 0 && criteria.length > 0) {
    diagnosis = criteria.map((criterion) => {
      const aloneCount = all.filter((group) => criterion.test(group)).length
      return { label: criterion.label, aloneCount, blocker: aloneCount === 0 }
    })
  }

  return {
    items: matched.map((group) => toGroupView(group, ruler)),
    total: matched.length,
    diagnosis,
    rangeError: '',
  }
}

export function allDcViews(): DcGroupView[] {
  const ruler = loadResistanceRuler()
  return listDcGroups().map((group) => toGroupView(group, ruler))
}

// ── 与设备巡视「待复查清单」的联动 ─────────────────────────────────────────────

/** djb2 哈希，给每个蓄电池组派生稳定的数字键，用于巡视编号与行 id */
function hashKey(text: string): number {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

function recheckCode(group: DcGroup): string {
  return `RC-${hashKey(group.key).toString(36).toUpperCase().padStart(6, '0')}`
}

function uniquePatrolId(rows: EntryRow[], key: string): number {
  const base = 900000 + (hashKey(key) % 9000)
  let id = base
  while (rows.some((row) => Number(row.id) === id && row.recheckKey !== key)) {
    id += 1
  }
  return id
}

/** 把一组异常蓄电池写进巡视待复查清单；同一组反复上报只更新同一行，不长第二条 */
export function upsertRecheckEntry(group: DcGroup): EntryRow {
  const rows = listRows('patrol')
  const latest = latestReading(group)
  const existing = rows.find((row) => row.recheckKey === group.key)
  if (existing) {
    const updated: EntryRow = {
      ...existing,
      status: '待巡视',
      pending: true,
      abnormal: true,
      巡视变电站: group.station,
      巡视路线: `蓄电池组 ${group.groupNo} 直流异常待复查`,
      巡视日期: group.abnormalMarkedAt ?? todayText(),
      处理情况: '待复查',
      巡视状态: '待复查',
      recheckVoltage: latest ? latest.cellVoltage : '',
      recheckResistance: latest ? latest.internalResistance : '',
      recheckCode: group.monitorCode,
    }
    saveRows('patrol', rows.map((row) => (row === existing ? updated : row)))
    return updated
  }

  const entry: EntryRow = {
    id: uniquePatrolId(rows, group.key),
    status: '待巡视',
    pending: true,
    abnormal: true,
    巡视编号: recheckCode(group),
    巡视变电站: group.station,
    巡视路线: `蓄电池组 ${group.groupNo} 直流异常待复查`,
    巡视人: '直流监测上报',
    巡视日期: group.abnormalMarkedAt ?? todayText(),
    发现缺陷数: '',
    处理情况: '待复查',
    巡视状态: '待复查',
    recheckKey: group.key,
    recheckSource: '直流系统监测',
    recheckGroupNo: group.groupNo,
    recheckVoltage: latest ? latest.cellVoltage : '',
    recheckResistance: latest ? latest.internalResistance : '',
    recheckCode: group.monitorCode,
  }
  saveRows('patrol', [...rows, entry])
  return entry
}

/** 启动/进入相关页面时对一次账：异常告警的组都应在待复查清单里，缺哪条补哪条，不重复补 */
export function syncRecheckFromGroups(): number {
  let added = 0
  for (const group of listDcGroups()) {
    if (group.status !== '异常告警') {
      continue
    }
    const rows = listRows('patrol')
    if (!rows.some((row) => row.recheckKey === group.key)) {
      upsertRecheckEntry(group)
      added += 1
    }
  }
  return added
}

export function listRecheckEntries(): EntryRow[] {
  return listRows('patrol').filter((row) => Boolean(row.recheckKey))
}

/** 巡视侧登记复查结果；不回写直流组的状态，是否恢复正常由直流专责判定 */
export function completeRecheck(id: number): ActionResult {
  const rows = listRows('patrol')
  const index = rows.findIndex((row) => Number(row.id) === id && Boolean(row.recheckKey))
  if (index < 0) {
    return { ok: false, message: '没有找到这条待复查记录' }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: '已完成',
    pending: false,
    abnormal: false,
    处理情况: '已复查',
    巡视状态: '已复查',
  }
  const next = [...rows]
  next[index] = updated
  saveRows('patrol', next)
  return { ok: true, message: '该蓄电池组已登记复查结果' }
}

// ── 直流组动作流转 ────────────────────────────────────────────────────────────

export function runDcAction(groupKey: string, action: string): ActionResult {
  const target = DC_ACTION_TARGET[action]
  if (!target) {
    return { ok: false, message: `直流监测没有登记「${action}」这个动作` }
  }
  const groups = listDcGroups()
  const index = groups.findIndex((group) => group.key === groupKey)
  if (index < 0) {
    return { ok: false, message: '没有找到这组蓄电池' }
  }
  const group = groups[index]
  if (group.status === target) {
    return { ok: false, message: `该组已经是「${target}」，不用重复操作` }
  }
  const nextGroup: DcGroup = {
    ...group,
    status: target,
    monitorCode: latestReading(group)?.code ?? group.monitorCode,
    abnormalMarkedAt:
      target === '异常告警' ? todayText() : target === '状态正常' ? undefined : group.abnormalMarkedAt,
  }
  const next = [...groups]
  next[index] = nextGroup
  saveDcGroups(next)

  if (target === '异常告警') {
    upsertRecheckEntry(nextGroup)
  }
  return {
    ok: true,
    message:
      target === '异常告警'
        ? `已标记异常，${group.station} ${group.groupNo} 已进入设备巡视待复查清单`
        : `该组已${action}，当前直流状态「${target}」`,
  }
}

// ── 内阻尺（直流专责定） ───────────────────────────────────────────────────────

export function getRuler(): ResistanceRuler {
  return loadResistanceRuler()
}

export function updateRuler(limit: number, owner: string): ActionResult {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, message: '内阻上限得是大于 0 的数字（mΩ）' }
  }
  saveResistanceRuler({ limit: Math.round(limit * 1000) / 1000, owner: owner.trim(), updatedAt: todayText() })
  return { ok: true, message: `内阻尺子已按 ${owner || '直流专责'} 的设定更新为 ${limit} mΩ` }
}

export function resetDc(): DcGroupView[] {
  resetDcGroups()
  syncRecheckFromGroups()
  return allDcViews()
}

export function exportDcGroups(): { filename: string; content: string } {
  const ruler = loadResistanceRuler()
  const header = ['所属变电站', '蓄电池组号', '直流状态', '监测编号', '单体电压(V)', '内阻(mΩ)', '是否超内阻尺', '监测人', '监测日期']
  const lines = [header.join(',')]
  for (const view of allDcViews()) {
    lines.push(
      [
        view.group.station,
        view.group.groupNo,
        view.group.status,
        view.latest?.code ?? '',
        view.voltage ?? '',
        view.resistance ?? '',
        view.overRuler ? `是(>${ruler.limit})` : '否',
        view.latest?.inspector ?? '',
        view.latest?.date ?? '',
      ].join(','),
    )
  }
  return { filename: '直流监测-蓄电池组清单.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadDcGroups(): void {
  const { filename, content } = exportDcGroups()
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
