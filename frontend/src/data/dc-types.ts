/** 直流系统监测的专用数据结构。
 * 数据按蓄电池组分档：每组一条档案（DcGroup），下挂该组的历次监测记录（DcReading）。
 * 列表与明细里看到的单体电压、内阻都取自同一份「最近一次监测」记录。 */

export type DcReading = {
  /** 监测编号，如 DCSY-000123 */
  code: string
  /** 监测日期 YYYY-MM-DD */
  date: string
  /** 监测人 */
  inspector: string
  /** 单体浮充电压（V），取自最近一次监测时作为该组当前电压 */
  cellVoltage: number
  /** 单体内阻（mΩ），尺子由直流专责设定 */
  internalResistance: number
  note: string
}

export type DcGroup = {
  /** 业务主键：同站组号唯一，也是与巡视待复查清单对账的键 */
  key: string
  station: string
  /** 蓄电池组号，如 1# */
  groupNo: string
  monitorCode: string
  /** 历次监测，按时间从旧到新存放，最后一条即最近一次监测 */
  readings: DcReading[]
  /** 工作流状态：待监测 / 监测中 / 状态正常 / 异常告警 */
  status: DcStatus
  /** 被人工标记异常的时间戳，用于与巡视清单对账 */
  abnormalMarkedAt?: string
}

export type DcStatus = '待监测' | '监测中' | '状态正常' | '异常告警'

/** 直流状态筛选项固定取这四档 */
export const DC_STATUSES: DcStatus[] = ['待监测', '监测中', '状态正常', '异常告警']

/** 内阻尺：上限由直流专责定（mΩ），超过即判「超内阻尺」 */
export type ResistanceRuler = {
  /** 内阻上限（mΩ），含等号 */
  limit: number
  /** 定尺人（直流专责） */
  owner: string
  /** 最近一次调整日期 */
  updatedAt: string
}

export type DcFilter = {
  stations: string[]
  groupNos: string[]
  statuses: DcStatus[]
  voltageMin: string
  voltageMax: string
  resistanceMin: string
  resistanceMax: string
  overRulerOnly: boolean
}

/** 列表/明细共用的一组「当前读数」视图，保证两处看到的单体电压是同一份 */
export type DcGroupView = {
  group: DcGroup
  latest: DcReading | null
  voltage: number | null
  resistance: number | null
  overRuler: boolean
}

export const DEFAULT_RESISTANCE_LIMIT = 0.8
