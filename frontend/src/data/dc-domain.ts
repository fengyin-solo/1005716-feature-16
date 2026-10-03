import type { EntryRow } from './types'

/**
 * 直流系统监测的领域层：
 * - 记录按「所属变电站 + 蓄电池组号」分档存放，一档就是一组蓄电池的多次监测；
 * - 列表与明细都以每档「最近一次监测」为准，保证两处看到的是同一份；
 * - 内阻尺子（告警上限）由直流专责设定，页面查询、超尺判断都用它。
 */

export const DC_MODULE_KEY = 'dcsystem'
export const DC_STATUSES = ['待监测', '监测中', '状态正常', '异常告警'] as const
export type DcStatus = (typeof DC_STATUSES)[number]

/** 直流专责定的内阻尺子：目前只卡上限，单位 mΩ。 */
export type ResistanceRule = {
  maxMilliOhm: number
  unit: string
  updatedBy: string
  updatedAt: string
}

/** 设备巡视里的「直流异常待复查清单」条目，同组蓄电池只有一条。 */
export type DcReviewItem = {
  id: number
  station: string
  groupNo: string
  groupKey: string
  latestDate: string
  cellVoltage: string
  resistance: string
  reason: string
  reportedAt: string
  reporter: string
  reviewed: boolean
  reviewer?: string
  reviewedAt?: string
}

export const DEFAULT_RESISTANCE_RULE: ResistanceRule = {
  maxMilliOhm: 0.45,
  unit: 'mΩ',
  updatedBy: '直流专责',
  updatedAt: '2026-07-01 09:00',
}

/** 蓄电池组定位条件：三个下拉叠加，两个数值区间设门槛。 */
export type DcGroupFilter = {
  station: string
  groupKey: string
  status: string
  voltageMin: string
  voltageMax: string
  resistanceMin: string
  resistanceMax: string
}

/** 列表与明细共用的组分档视图：数值全部取自该档最近一次监测。 */
export type DcGroup = {
  groupKey: string
  station: string
  groupNo: string
  latest: EntryRow
  recordCount: number
  cellVoltage: number | null
  resistance: number | null
}

export type DcFilterCondition =
  | { kind: 'station'; label: string; value: string; test: (group: DcGroup) => boolean }
  | { kind: 'group'; label: string; value: string; test: (group: DcGroup) => boolean }
  | { kind: 'status'; label: string; value: string; test: (group: DcGroup) => boolean }
  | {
      kind: 'range'
      field: 'voltage' | 'resistance'
      label: string
      min: number
      max: number
      test: (group: DcGroup) => boolean
    }

export type DcRangeProblem = {
  field: 'voltage' | 'resistance'
  label: string
  message: string
}

export type DcDiagnosis = {
  total: number
  problems: DcRangeProblem[]
  blockers: { label: string; detail: string }[]
}

export type DcGroupQuery = {
  groups: DcGroup[]
  total: number
  conditions: DcFilterCondition[]
  diagnosis: DcDiagnosis
}

export type DcFacets = {
  stations: string[]
  groupsByStation: Record<string, { key: string; label: string }[]>
  statuses: string[]
}

export function emptyDcGroupFilter(): DcGroupFilter {
  return {
    station: '',
    groupKey: '',
    status: '',
    voltageMin: '',
    voltageMax: '',
    resistanceMin: '',
    resistanceMax: '',
  }
}

type GroupKind = 'normal' | 'watching' | 'abnormal'
type AbnormalKind = 'underVoltage' | 'overVoltage' | 'highResistance'

const STATIONS: { name: string; groupCount: number }[] = [
  { name: '220kV青山变电站', groupCount: 24 },
  { name: '220kV滨江变电站', groupCount: 22 },
  { name: '220kV云岭变电站', groupCount: 20 },
  { name: '110kV望江变电站', groupCount: 18 },
  { name: '110kV梅湖变电站', groupCount: 16 },
  { name: '110kV新港变电站', groupCount: 16 },
  { name: '35kV铜溪变电站', groupCount: 12 },
  { name: '35kV枫岭变电站', groupCount: 12 },
]

const MONITORS = ['陈卫东', '李海燕', '王建国', '赵敏', '周永强']
const REPORT_BASE = new Date('2026-10-02T08:00:00')

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function dateText(daysAgo: number): string {
  const date = new Date(REPORT_BASE)
  date.setDate(date.getDate() - daysAgo)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function dateTimeText(daysAgo: number, hour: number): string {
  return `${dateText(daysAgo)} ${pad2(hour)}:00`
}

function fixed2(value: number): string {
  return value.toFixed(2)
}

function fixed3(value: number): string {
  return value.toFixed(3)
}

/**
 * 生成直流监测种子：每个站若干组蓄电池，每组 2~4 档历史记录，
 * 记录按组分档存放（同组记录连续）。数值围绕 2V 阀控铅酸蓄电池的常见区间。
 */
export function buildDcSeed(): { records: EntryRow[]; reviews: DcReviewItem[] } {
  const random = mulberry32(20261002)
  const records: EntryRow[] = []
  const reviews: DcReviewItem[] = []
  let serial = 0
  let reviewId = 0

  STATIONS.forEach((station, stationIndex) => {
    for (let groupIndex = 1; groupIndex <= station.groupCount; groupIndex += 1) {
      const groupNo = `#${pad2(groupIndex)}组`
      const groupKey = `${station.name}|${groupNo}`
      const roll = random()
      // 约两成组落在监测中/异常告警，方便值长直接捞错峰组。
      let kind: GroupKind = 'normal'
      if (roll < 0.08) {
        kind = 'watching'
      } else if (roll < 0.2) {
        kind = 'abnormal'
      }

      const historyCount = 2 + Math.floor(random() * 3) // 2~4 档
      // 最近一次监测集中在 9 月下旬到 10 月初，符合「看最近一次」的场景。
      const latestDaysAgo = Math.floor(random() * 16)
      const daysAgoList: number[] = [latestDaysAgo]
      let cursor = latestDaysAgo
      for (let i = 1; i < historyCount; i += 1) {
        cursor += 14 + Math.floor(random() * 20) // 每档间隔 2~5 周
        daysAgoList.push(Math.min(cursor, 92))
      }

      const abnormalKinds: AbnormalKind[] = ['underVoltage', 'overVoltage', 'highResistance']
      const abnormalKind = abnormalKinds[Math.floor(random() * abnormalKinds.length)]

      daysAgoList.forEach((daysAgo, index) => {
        const isLatest = index === 0
        serial += 1
        const monitorId = `DCSY-${String(serial).padStart(4, '0')}`
        const monitor = MONITORS[(stationIndex + groupIndex + index) % MONITORS.length]
        let status: string
        let abnormal = false
        let voltage = fixed2(2.2 + random() * 0.07) // 浮充正常 2.20~2.27V
        let resistance = fixed3(0.24 + random() * 0.19) // 0.240~0.429mΩ

        if (isLatest) {
          if (kind === 'watching') {
            status = '监测中'
          } else if (kind === 'abnormal') {
            status = '异常告警'
            abnormal = true
            if (abnormalKind === 'underVoltage') {
              voltage = fixed2(2.05 + random() * 0.1) // 2.05~2.14V 欠压
            } else if (abnormalKind === 'overVoltage') {
              voltage = fixed2(2.3 + random() * 0.08) // 2.30~2.37V 过压
            } else {
              resistance = fixed3(0.47 + random() * 0.16) // 0.470~0.629mΩ 超内阻尺
            }
          } else {
            status = '状态正常'
          }
        } else {
          // 历史档基本都是正常态，个别保留监测中痕迹。
          status = random() < 0.12 ? '监测中' : '状态正常'
        }

        records.push({
          id: serial,
          status,
          pending: status === '待监测' || status === '监测中',
          abnormal,
          监测编号: monitorId,
          所属变电站: station.name,
          蓄电池组号: groupNo,
          单体电压: `${voltage}`,
          内阻: `${resistance}`,
          监测人: monitor,
          监测日期: dateText(daysAgo),
          直流状态: status,
          组分档键: groupKey,
        })
      })

      if (kind === 'abnormal') {
        const latestRecord = records[records.length - daysAgoList.length]
        reviewId += 1
        const reasonText =
          abnormalKind === 'highResistance'
            ? '内阻超直流专责尺子'
            : abnormalKind === 'underVoltage'
              ? '单体电压低于浮充区间'
              : '单体电压高于浮充区间'
        reviews.push({
          id: reviewId,
          station: station.name,
          groupNo,
          groupKey,
          latestDate: String(latestRecord.监测日期),
          cellVoltage: String(latestRecord.单体电压),
          resistance: String(latestRecord.内阻),
          reason: reasonText,
          reportedAt: dateTimeText(latestDaysAgo, 9 + (reviewId % 8)),
          reporter: '直流系统监测',
          reviewed: false,
        })
      }
    }
  })

  return { records, reviews }
}
