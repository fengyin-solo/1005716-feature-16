import assert from 'node:assert'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'

const virtualSource = `
import assert from 'node:assert'
import { buildDcSeedGroups } from '@/data/dc-seed'
import { listDcGroups } from '@/data/dc-store'
import { queryDcGroups, runDcAction, listRecheckEntries, completeRecheck, updateRuler, getRuler, resetDc, syncRecheckFromGroups } from '@/api/dc-service'
import { listRows } from '@/data/local-store'

const results = []
function check(name, fn) {
  try { fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name + ' :: ' + e.message]) }
}

// 极简 localStorage mock
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}
globalThis.window = { localStorage: globalThis.localStorage }

const groups = listDcGroups()
check('种子蓄电池组为数百组', () => assert.ok(groups.length >= 200, '实际 ' + groups.length))
check('每组至少一条监测记录', () => assert.ok(groups.every(g => g.readings.length >= 1)))
check('组键全站唯一', () => {
  const keys = groups.map(g => g.key)
  assert.strictEqual(new Set(keys).size, keys.length)
})
check('记录按日期从旧到新', () => {
  for (const g of groups) {
    for (let i = 1; i < g.readings.length; i++) {
      assert.ok(g.readings[i - 1].date <= g.readings[i].date, g.key)
    }
  }
})

const abnormalSeed = groups.filter(g => g.status === '异常告警')
check('种子里存在异常告警组', () => assert.ok(abnormalSeed.length >= 3, String(abnormalSeed.length)))

// 初始同步：异常组全部进待复查清单
syncRecheckFromGroups()
const recheck0 = listRecheckEntries()
check('异常告警组数 = 初始待复查条数', () => assert.strictEqual(recheck0.length, abnormalSeed.length))
check('待复查项按组键不重复', () => {
  const ks = recheck0.map(r => r.recheckKey)
  assert.strictEqual(new Set(ks).size, ks.length)
})

// 反复标异常不长第二条
const target = groups.find(g => g.status === '状态正常')
runDcAction(target.key, '标记异常')
const countAfter1 = listRecheckEntries().filter(r => r.recheckKey === target.key).length
runDcAction(target.key, '判定正常')
runDcAction(target.key, '标记异常')
const countAfter2 = listRecheckEntries().filter(r => r.recheckKey === target.key).length
check('同一组反复上报只保留一条待复查', () => {
  assert.strictEqual(countAfter1, 1)
  assert.strictEqual(countAfter2, 1)
})

// 复查登记
const entry = listRecheckEntries().find(r => r.recheckKey === target.key)
const before = listRecheckEntries().length
completeRecheck(Number(entry.id))
const after = listRecheckEntries().filter(r => r.recheckKey === target.key)[0]
check('登记复查后状态变已复查且行不删', () => {
  assert.strictEqual(after.巡视状态, '已复查')
  assert.strictEqual(listRecheckEntries().length, before)
})

// 筛选：空条件返回全部
const all = queryDcGroups({ stations: [], groupNos: [], statuses: [], voltageMin: '', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('无条件命中全部组', () => assert.strictEqual(all.total, groups.length))

// 单站
const station = groups[0].station
const q1 = queryDcGroups({ stations: [station], groupNos: [], statuses: [], voltageMin: '', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('按变电站筛选数量正确', () => assert.strictEqual(q1.total, groups.filter(g => g.station === station).length))

// 状态多选叠变电站（交集）；此时已有测试把一个正常组标成异常，故期望以当前数据为准
const currentGroups = listDcGroups()
const q2 = queryDcGroups({ stations: [station], groupNos: [], statuses: ['异常告警'], voltageMin: '', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('变电站+异常状态叠加取交集', () => {
  const expect = currentGroups.filter(g => g.station === station && g.status === '异常告警').length
  assert.strictEqual(q2.total, expect)
})

// 电压区间
const q3 = queryDcGroups({ stations: [], groupNos: [], statuses: [], voltageMin: '2.20', voltageMax: '2.30', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('电压区间为闭区间且取最近一次监测', () => {
  const expect = groups.filter(g => {
    const v = g.readings[g.readings.length - 1].cellVoltage
    return v >= 2.20 && v <= 2.30
  }).length
  assert.strictEqual(q3.total, expect)
  assert.ok(q3.items.every(i => i.voltage >= 2.20 && i.voltage <= 2.30))
})

// 列表与明细同源
check('视图电压与最近一次监测一致', () => {
  for (const item of q3.items) {
    assert.strictEqual(item.voltage, item.latest.cellVoltage)
    assert.strictEqual(item.voltage, item.group.readings[item.group.readings.length - 1].cellVoltage)
  }
})

// 内阻尺
updateRuler(0.5, '测试专责')
const ruler = getRuler()
check('内阻尺可由专责调整并持久化', () => {
  assert.strictEqual(ruler.limit, 0.5)
  assert.strictEqual(ruler.owner, '测试专责')
})
const q4 = queryDcGroups({ stations: [], groupNos: [], statuses: [], voltageMin: '', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: true })
check('只看超内阻尺命中正确', () => {
  const expect = groups.filter(g => g.readings[g.readings.length - 1].internalResistance > 0.5).length
  assert.strictEqual(q4.total, expect)
})
check('超尺标记正确', () => assert.ok(q4.items.every(i => i.overRuler)))

// 区间写反
const bad = queryDcGroups({ stations: [], groupNos: [], statuses: [], voltageMin: '2.4', voltageMax: '2.1', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('电压起止写反给出 rangeError', () => assert.ok(bad.rangeError.includes('起始值不能大于截止值')))

// 零命中归因：选一个不存在交集的组合（单站 × 一个该站没有的组号区间）
const stationGroups = groups.filter(g => g.station === station)
const pick = stationGroups[0]
// 构造必然零命中：组号锁定 pick，状态锁定一个它不具备的、且该站具备其他组的状态
const otherStatus = ['待监测','监测中','状态正常','异常告警'].find(s => stationGroups.some(g => g.status === s) && pick.status !== s)
const q5 = queryDcGroups({ stations: [station], groupNos: [pick.groupNo], statuses: [otherStatus], voltageMin: '', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('零命中时逐项归因', () => {
  assert.strictEqual(q5.total, 0)
  assert.ok(q5.diagnosis.length === 3)
  // 没有单项为 0（该站有组、组号存在、状态存在），但叠加为 0
  assert.ok(q5.diagnosis.every(d => d.aloneCount >= 1))
})

// 单项堵死：电压区间设成物理上不可能
const q6 = queryDcGroups({ stations: [], groupNos: [], statuses: [], voltageMin: '9', voltageMax: '', resistanceMin: '', resistanceMax: '', overRulerOnly: false })
check('单项过窄标记 blocker', () => {
  assert.strictEqual(q6.total, 0)
  const blocker = q6.diagnosis.find(d => d.blocker)
  assert.ok(blocker, '应有 blocker 项')
  assert.strictEqual(blocker.aloneCount, 0)
})

// 重置
resetDc()
check('重置后组数回到种子数', () => assert.strictEqual(listDcGroups().length, groups.length))

console.log(JSON.stringify(results))
`

writeFileSync(process.cwd() + '/node_modules/.verify-entry.ts', virtualSource)
const result = await build({
  entryPoints: [process.cwd() + '/node_modules/.verify-entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: { '@': process.cwd() + '/src' },
})
const outPath = process.cwd() + '/node_modules/.verify.mjs'
writeFileSync(outPath, result.outputFiles[0].text)
await import(pathToFileURL(outPath).href)
