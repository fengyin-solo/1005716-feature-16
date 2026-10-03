import type { DcGroup, DcReading, DcStatus } from './dc-types'

/**
 * 直流监测示例数据：按蓄电池组分档，每组带 1~5 次监测记录。
 * 用固定种子的伪随机生成，保证每次重建都一致；总量在三百组以上，值长能体会筛选定位的必要。
 */

const STATION_PLAN: { name: string; groups: number }[] = [
  { name: '220kV 香山变', groups: 42 },
  { name: '220kV 望江变', groups: 38 },
  { name: '110kV 柳洲变', groups: 36 },
  { name: '110kV 青塘变', groups: 34 },
  { name: '110kV 云栖变', groups: 32 },
  { name: '35kV 梅溪变', groups: 30 },
  { name: '35kV 枫林变', groups: 28 },
  { name: '35kV 桃源变', groups: 26 },
]

const INSPECTORS = ['周建国', '李海峰', '王志强', '陈晓敏', '赵国梁', '孙立军']
const NOTES = ['定期巡检测试', '充放电核对性试验', '季度内阻普测', '高温特巡', '交接班抽测', '浮充电压巡检']

// mulberry32：固定种子，刷新/重建结果都一样
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0')
}

function dateBefore(daysBefore: number): string {
  // 固定锚点 2026-10-01，避免示例数据随真实日期漂移
  const anchor = new Date(2026, 9, 1)
  anchor.setDate(anchor.getDate() - daysBefore)
  return `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1, 2)}-${pad(anchor.getDate(), 2)}`
}

/** 生成一组的若干次监测记录：越靠后越新，电压/内阻有轻微漂移 */
function buildReadings(
  rnd: () => number,
  serial: { n: number },
  count: number,
  baseVoltage: number,
  baseResistance: number,
  drift: number,
): DcReading[] {
  const readings: DcReading[] = []
  // 最新一次距今天 1~20 天，其余往前每 25~45 天一次
  let gap = 1 + Math.floor(rnd() * 20)
  for (let i = 0; i < count; i += 1) {
    const wobble = (rnd() - 0.5) * drift
    const rWobble = (rnd() - 0.5) * 0.08
    readings.push({
      code: `DCSY-${pad(serial.n, 6)}`,
      date: dateBefore(gap + (count - 1 - i) * (25 + Math.floor(rnd() * 20))),
      inspector: INSPECTORS[Math.floor(rnd() * INSPECTORS.length)],
      cellVoltage: round2(baseVoltage + wobble + (count - 1 - i) * 0.004),
      internalResistance: round2(Math.max(0.18, baseResistance + rWobble - (count - 1 - i) * 0.01)),
      note: NOTES[Math.floor(rnd() * NOTES.length)],
    })
    serial.n += 1
  }
  // 上面的日期公式对每条独立，这里统一按日期从旧到新排序，保证最后一条是最近一次监测
  return readings.sort((a, b) => a.date.localeCompare(b.date))
}

export function buildDcSeedGroups(): DcGroup[] {
  const rnd = mulberry32(20261003)
  const serial = { n: 1 }
  const groups: DcGroup[] = []

  // 人为点名几组异常/越限，方便值长第一次打开就有东西可捞
  const forcedAbnormal = new Set(['220kV 香山变|7#', '110kV 柳洲变|12#', '35kV 梅溪变|3#', '220kV 望江变|21#'])
  const forcedOverRuler = new Set(['110kV 青塘变|5#', '35kV 枫林变|9#', '110kV 云栖变|18#'])

  for (const station of STATION_PLAN) {
    for (let g = 1; g <= station.groups; g += 1) {
      const groupNo = `${g}#`
      const key = `${station.name}|${groupNo}`
      const readingCount = 1 + Math.floor(rnd() * 5)

      // 主流是浮充正常区间 2.20~2.30V；少量压到 2.15~2.19（偏低）或 2.31~2.36（偏高）
      const bucket = rnd()
      let baseVoltage: number
      if (bucket < 0.86) {
        baseVoltage = round2(2.2 + rnd() * 0.1)
      } else if (bucket < 0.94) {
        baseVoltage = round2(2.14 + rnd() * 0.05)
      } else {
        baseVoltage = round2(2.3 + rnd() * 0.07)
      }
      let baseResistance = round2(0.35 + rnd() * 0.4)

      let status: DcStatus = '状态正常'
      const roll = rnd()
      if (roll < 0.06) {
        status = '待监测'
      } else if (roll < 0.12) {
        status = '监测中'
      }

      if (forcedOverRuler.has(key)) {
        baseResistance = round2(0.86 + rnd() * 0.25)
      }
      if (forcedAbnormal.has(key)) {
        // 异常组：电压越限或内阻明显偏大
        baseVoltage = rnd() < 0.5 ? round2(2.06 + rnd() * 0.09) : round2(2.36 + rnd() * 0.05)
        baseResistance = round2(0.9 + rnd() * 0.3)
        status = '异常告警'
      }

      const readings = buildReadings(rnd, serial, readingCount, baseVoltage, baseResistance, 0.03)
      groups.push({
        key,
        station: station.name,
        groupNo,
        monitorCode: readings[readings.length - 1].code,
        readings,
        status,
        abnormalMarkedAt: status === '异常告警' ? readings[readings.length - 1].date : undefined,
      })
    }
  }
  return groups
}
