<template>
  <section class="page dc-page" data-module="dcsystem">
    <header class="page-head">
      <div>
        <h2>直流系统监测 · 蓄电池组定位</h2>
        <p class="page-desc">
          几百组蓄电池按组分档存放。组号、变电站、直流状态可叠着选，单体电压与内阻按起止区间设门槛，
          符合条件的组数随手报出来；一格都没配上时会指出是哪一项卡得太窄。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出蓄电池组清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="ruler-card">
      <div class="ruler-head" @click="rulerOpen = !rulerOpen">
        <strong>内阻尺（直流专责定）</strong>
        <span class="ruler-current">
          当前上限：<b>{{ ruler.limit }}</b> mΩ
          <template v-if="ruler.owner"> · 定尺人：{{ ruler.owner }}</template>
          <template v-if="ruler.updatedAt"> · 调整于 {{ ruler.updatedAt }}</template>
        </span>
        <span class="ruler-toggle">{{ rulerOpen ? '收起' : '调整' }} ▾</span>
      </div>
      <form v-if="rulerOpen" class="ruler-form" @submit.prevent="saveRuler">
        <label class="range-item">
          <span>内阻上限 (mΩ)</span>
          <input v-model="rulerDraft.limit" type="number" step="0.01" min="0.01" />
        </label>
        <label class="range-item">
          <span>直流专责（定尺人）</span>
          <input v-model="rulerDraft.owner" type="text" placeholder="姓名" />
        </label>
        <div class="ruler-presets">
          <span class="ruler-presets-label">常用尺：</span>
          <button v-for="preset in RULER_PRESETS" :key="preset" class="btn ghost" type="button" @click="rulerDraft.limit = String(preset)">
            {{ preset }}
          </button>
        </div>
        <button class="btn primary" type="submit">保存内阻尺</button>
        <span v-if="rulerMessage" class="ruler-message" :class="{ 'error-text': !rulerMessageOk }">{{ rulerMessage }}</span>
      </form>
    </section>

    <form class="filter-panel" @submit.prevent>
      <div class="filter-grid">
        <label class="range-item">
          <span>所属变电站</span>
          <MultiSelect v-model="filter.stations" title="变电站" :options="stationOptions" searchable />
        </label>
        <label class="range-item">
          <span>蓄电池组号</span>
          <MultiSelect v-model="filter.groupNos" title="组号" :options="groupNoOptions" searchable />
        </label>
        <label class="range-item">
          <span>直流状态</span>
          <MultiSelect v-model="filter.statuses" title="直流状态" :options="statusOptions" />
        </label>
        <label class="range-item">
          <span>单体电压区间 (V)</span>
          <span class="range-inputs">
            <input v-model="filter.voltageMin" type="number" step="0.01" placeholder="起" />
            <em>～</em>
            <input v-model="filter.voltageMax" type="number" step="0.01" placeholder="止" />
          </span>
        </label>
        <label class="range-item">
          <span>内阻区间 (mΩ)</span>
          <span class="range-inputs">
            <input v-model="filter.resistanceMin" type="number" step="0.01" placeholder="起" />
            <em>～</em>
            <input v-model="filter.resistanceMax" type="number" step="0.01" placeholder="止" />
          </span>
        </label>
        <label class="range-item ruler-switch-item">
          <span>&nbsp;</span>
          <label class="check-line">
            <input v-model="filter.overRulerOnly" type="checkbox" />
            <span>只看超内阻尺的组（&gt; {{ ruler.limit }} mΩ）</span>
          </label>
        </label>
      </div>
      <div class="filter-actions">
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
        <span class="hit-count">符合条件：<b>{{ result.total }}</b> 组 / 共 {{ views.length }} 组</span>
      </div>

      <p v-if="result.rangeError" class="error-text diagnose">{{ result.rangeError }}</p>
      <div v-else-if="result.total === 0 && hasAnyCondition" class="diagnose">
        <p class="diagnose-title">一组都没配上，逐项回退看是哪一项卡得太窄：</p>
        <ul>
          <li v-for="item in result.diagnosis" :key="item.label" :class="{ blocker: item.blocker }">
            <span class="diagnose-label">{{ item.label }}</span>
            <span v-if="item.blocker" class="diagnose-tag">这项单独就 0 组，先放宽它</span>
            <span v-else class="diagnose-hint">单独开能配 {{ item.aloneCount }} 组，是与其他条件叠加后被挤掉的</span>
          </li>
        </ul>
      </div>
    </form>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item ruler-legend">超内阻尺：{{ overRulerCount }}</span>
    </p>

    <table class="data-table dc-table">
      <thead>
        <tr>
          <th>所属变电站</th>
          <th>蓄电池组号</th>
          <th>直流状态</th>
          <th>监测编号</th>
          <th>单体电压 (V)</th>
          <th>内阻 (mΩ)</th>
          <th>监测人</th>
          <th>最近监测日期</th>
          <th>明细 / 处置</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="view in result.items" :key="view.group.key" :class="{ 'row-abnormal': view.group.status === '异常告警' }">
          <td>{{ view.group.station }}</td>
          <td>{{ view.group.groupNo }}</td>
          <td>
            <span class="status-tag" :data-status="view.group.status">{{ view.group.status }}</span>
          </td>
          <td>{{ view.latest?.code ?? '—' }}</td>
          <td :class="{ 'cell-warn': view.voltage !== null && isVoltageWarn(view.voltage) }">
            {{ view.voltage === null ? '—' : view.voltage.toFixed(2) }}
          </td>
          <td :class="{ 'cell-warn': view.overRuler }">
            {{ view.resistance === null ? '—' : view.resistance.toFixed(2) }}
            <span v-if="view.overRuler" class="over-tag">超尺</span>
          </td>
          <td>{{ view.latest?.inspector ?? '—' }}</td>
          <td>{{ view.latest?.date ?? '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(view)">监测明细</button>
            <button
              v-if="view.group.status !== '异常告警'"
              class="link danger"
              type="button"
              @click="markAbnormal(view)"
            >
              标记异常
            </button>
            <button
              v-else
              class="link"
              type="button"
              disabled
              title="已进入设备巡视待复查清单"
            >
              待复查中
            </button>
          </td>
        </tr>
        <tr v-if="result.items.length === 0">
          <td colspan="9" class="empty-state">
            {{ hasAnyCondition ? '当前条件下没有配上的蓄电池组，请看上方归因提示放宽条件' : '暂无直流监测数据' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>列表与明细的单体电压同取最近一次监测记录（{{ views.length }} 组分档存放）</span>
      <span v-if="actionMessage" class="action-message" :class="{ 'error-text': !actionOk }">{{ actionMessage }}</span>
    </footer>

    <!-- 监测明细抽屉：与列表共享同一份最近监测，历次监测按时间列全 -->
    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ detail.group.station }} · 蓄电池组 {{ detail.group.groupNo }}</h3>
            <p class="page-desc">记录按蓄电池组分档存放，下表为该组全部历次监测</p>
          </div>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <div class="drawer-latest">
          <div class="latest-item">
            <span>直流状态</span>
            <strong><span class="status-tag" :data-status="detail.group.status">{{ detail.group.status }}</span></strong>
          </div>
          <div class="latest-item">
            <span>单体电压（最近一次监测）</span>
            <strong :class="{ 'cell-warn': detail.voltage !== null && isVoltageWarn(detail.voltage) }">
              {{ detail.voltage === null ? '—' : detail.voltage.toFixed(2) }} V
            </strong>
          </div>
          <div class="latest-item">
            <span>内阻（最近一次监测）</span>
            <strong :class="{ 'cell-warn': detail.overRuler }">
              {{ detail.resistance === null ? '—' : detail.resistance.toFixed(2) }} mΩ
              <span v-if="detail.overRuler" class="over-tag">超内阻尺（{{ ruler.limit }} mΩ）</span>
            </strong>
          </div>
        </div>

        <table class="data-table">
          <thead>
            <tr>
              <th>监测编号</th>
              <th>监测日期</th>
              <th>单体电压 (V)</th>
              <th>内阻 (mΩ)</th>
              <th>监测人</th>
              <th>监测说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reading in [...detail.group.readings].reverse()" :key="reading.code" :class="{ 'latest-row': reading.code === detail.latest?.code }">
              <td>{{ reading.code }}</td>
              <td>{{ reading.date }}</td>
              <td :class="{ 'cell-warn': isVoltageWarn(reading.cellVoltage) }">{{ reading.cellVoltage.toFixed(2) }}</td>
              <td :class="{ 'cell-warn': reading.internalResistance > ruler.limit }">{{ reading.internalResistance.toFixed(2) }}</td>
              <td>{{ reading.inspector }}</td>
              <td>{{ reading.note }}</td>
            </tr>
          </tbody>
        </table>
        <p class="latest-hint">高亮一行为最近一次监测，即列表中展示的单体电压与内阻，两处为同一份数据。</p>

        <footer class="drawer-foot">
          <template v-if="detail.group.status === '异常告警'">
            <button class="btn" type="button" disabled>已在设备巡视待复查清单</button>
          </template>
          <template v-else>
            <button class="btn" type="button" @click="submitMonitor">提交监测</button>
            <button class="btn" type="button" @click="markNormal">判定正常</button>
            <button class="btn primary" type="button" @click="markAbnormal(detail)">标记异常并送复查</button>
          </template>
        </footer>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import MultiSelect from './MultiSelect.vue'
import { downloadEntries } from '@/api/local-service'
import {
  allDcViews,
  getRuler,
  queryDcGroups,
  runDcAction,
  syncRecheckFromGroups,
  updateRuler,
} from '@/api/dc-service'
import { DC_STATUSES } from '@/data/dc-types'
import type { DcFilter, DcGroupView } from '@/data/dc-types'

const RULER_PRESETS = [0.6, 0.8, 1.0]
// 浮充单体电压关注区间，仅用于页面提示，不参与状态流转
const VOLTAGE_NORMAL_MIN = 2.18
const VOLTAGE_NORMAL_MAX = 2.35

const views = ref<DcGroupView[]>([])
const ruler = ref(getRuler())
const stationOptions = ref<string[]>([])
const groupNoOptions = ref<string[]>([])
const statusOptions = DC_STATUSES

const filter = reactive<DcFilter>({
  stations: [],
  groupNos: [],
  statuses: [],
  voltageMin: '',
  voltageMax: '',
  resistanceMin: '',
  resistanceMax: '',
  overRulerOnly: false,
})

const result = computed(() => queryDcGroups(filter))
const hasAnyCondition = computed(
  () =>
    filter.stations.length > 0 ||
    filter.groupNos.length > 0 ||
    filter.statuses.length > 0 ||
    filter.voltageMin.trim() !== '' ||
    filter.voltageMax.trim() !== '' ||
    filter.resistanceMin.trim() !== '' ||
    filter.resistanceMax.trim() !== '' ||
    filter.overRulerOnly,
)

const stats = computed(() => [
  { label: '蓄电池组总数', value: views.value.length },
  { label: '状态正常组数', value: countByStatus('状态正常') },
  { label: '异常告警组数', value: countByStatus('异常告警') },
  { label: '监测中/待监测', value: countByStatus('监测中') + countByStatus('待监测') },
])

function countByStatus(status: string): number {
  return views.value.filter((view) => view.group.status === status).length
}

const overRulerCount = computed(() => views.value.filter((view) => view.overRuler).length)
const statusSummary = computed(() =>
  statusOptions.map((status) => ({ status, count: countByStatus(status) })),
)

function isVoltageWarn(voltage: number | null): boolean {
  return voltage !== null && (voltage < VOLTAGE_NORMAL_MIN || voltage > VOLTAGE_NORMAL_MAX)
}

function resetFilters() {
  filter.stations = []
  filter.groupNos = []
  filter.statuses = []
  filter.voltageMin = ''
  filter.voltageMax = ''
  filter.resistanceMin = ''
  filter.resistanceMax = ''
  filter.overRulerOnly = false
  actionMessage.value = ''
}

// ── 内阻尺 ────────────────────────────────────────────────────────────────────
const rulerOpen = ref(false)
const rulerDraft = reactive({ limit: String(ruler.value.limit), owner: ruler.value.owner })
const rulerMessage = ref('')
const rulerMessageOk = ref(true)

function saveRuler() {
  const limit = Number(rulerDraft.limit)
  const reply = updateRuler(limit, rulerDraft.owner)
  rulerMessage.value = reply.message
  rulerMessageOk.value = reply.ok
  if (reply.ok) {
    ruler.value = getRuler()
    reload()
    rulerOpen.value = false
  }
}

// ── 明细抽屉与动作 ─────────────────────────────────────────────────────────────
const detail = ref<DcGroupView | null>(null)
const actionMessage = ref('')
const actionOk = ref(true)

function refreshView(view: DcGroupView): DcGroupView | null {
  const groups = allDcViews()
  views.value = groups
  const fresh = groups.find((item) => item.group.key === view.group.key)
  detail.value = fresh ?? null
  return fresh ?? null
}

function openDetail(view: DcGroupView) {
  detail.value = view
  actionMessage.value = ''
}

function closeDetail() {
  detail.value = null
}

function applyAction(view: DcGroupView, action: string) {
  actionMessage.value = ''
  const reply = runDcAction(view.group.key, action)
  actionOk.value = reply.ok
  actionMessage.value = reply.message
  if (reply.ok) {
    reload()
    const fresh = refreshView(view)
    if (fresh && fresh.group.status === '状态正常') {
      closeDetail()
    }
  }
}

function markAbnormal(view: DcGroupView) {
  applyAction(view, '标记异常')
}

function markNormal() {
  if (detail.value) {
    applyAction(detail.value, '判定正常')
  }
}

function submitMonitor() {
  if (detail.value) {
    applyAction(detail.value, '提交监测')
  }
}

function exportRows() {
  downloadEntries('dcsystem')
}

function reload() {
  views.value = allDcViews()
  stationOptions.value = [...new Set(views.value.map((view) => view.group.station))]
  groupNoOptions.value = [...new Set(views.value.map((view) => view.group.groupNo))].sort(
    (a, b) => parseInt(a, 10) - parseInt(b, 10),
  )
}

onMounted(() => {
  syncRecheckFromGroups()
  reload()
  ruler.value = getRuler()
  rulerDraft.limit = String(ruler.value.limit)
  rulerDraft.owner = ruler.value.owner
})
</script>

<style scoped>
.dc-page .filter-panel {
  background: #fff; border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; margin-bottom: 12px;
}
.filter-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.range-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.range-item input[type='number'], .range-item input[type='text'] {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
}
.range-inputs { display: flex; align-items: center; gap: 6px; }
.range-inputs input { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.range-inputs em { color: var(--muted); font-style: normal; }
.ruler-switch-item { align-self: end; }
.check-line { display: flex; gap: 6px; align-items: center; font-size: 13px; padding-bottom: 6px; }
.filter-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.hit-count { font-size: 13px; color: var(--muted); }
.hit-count b { color: var(--brand); font-size: 16px; }
.diagnose { margin-top: 10px; border: 1px solid #f2c2bd; background: #fdf3f2; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
.diagnose-title { margin: 0 0 6px; color: #b42318; font-weight: 600; }
.diagnose ul { margin: 0; padding-left: 18px; }
.diagnose li { margin: 3px 0; }
.diagnose li.blocker .diagnose-label { color: #b42318; font-weight: 600; }
.diagnose-tag { color: #b42318; margin-left: 6px; }
.diagnose-hint { color: var(--muted); margin-left: 6px; }

.ruler-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.ruler-head { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.ruler-current { font-size: 13px; color: var(--muted); }
.ruler-current b { color: #b45309; }
.ruler-toggle { margin-left: auto; font-size: 12px; color: var(--brand); }
.ruler-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-top: 12px; }
.ruler-form .range-item { min-width: 180px; }
.ruler-presets { display: flex; align-items: center; gap: 6px; }
.ruler-presets-label { font-size: 12px; color: var(--muted); }
.ruler-message { font-size: 12px; }

.status-tag { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.status-tag[data-status='状态正常'] { background: #e7f6ec; color: #1a7f37; }
.status-tag[data-status='异常告警'] { background: #fde8e6; color: #b42318; }
.status-tag[data-status='监测中'] { background: #e8f0fe; color: #1f6feb; }
.status-tag[data-status='待监测'] { background: #eef2f7; color: #475569; }
.cell-warn { color: #b42318; font-weight: 600; }
.over-tag { display: inline-block; margin-left: 4px; background: #fef3c7; color: #92400e; border-radius: 4px; padding: 0 6px; font-size: 11px; font-weight: 600; }
.row-abnormal { background: #fff8f7; }
.ruler-legend { background: #fef3c7; color: #92400e; }
.link.danger { color: #b42318; }
.link:disabled { color: #9aa6b4; cursor: default; }
.action-message { font-size: 12px; }

.drawer-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); z-index: 50; display: flex; justify-content: flex-end; }
.drawer { width: 760px; max-width: 94vw; background: #f6f8fb; height: 100%; overflow: auto; padding: 16px 20px; }
.drawer-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.drawer-head h3 { margin: 0 0 4px; }
.drawer-latest { display: flex; gap: 12px; margin-bottom: 12px; }
.latest-item { flex: 1; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.latest-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.latest-row td { background: #eef6ff; }
.latest-hint { font-size: 12px; color: var(--muted); margin: 8px 0; }
.drawer-foot { display: flex; gap: 8px; margin-top: 12px; }

@media (max-width: 960px) {
  .filter-grid { grid-template-columns: 1fr; }
}
</style>
