<template>
  <section class="page dc-page" data-module="dcsystem">
    <header class="page-head">
      <div>
        <h2>直流系统监测 · 错峰组定位</h2>
        <p class="page-desc">
          监测记录按蓄电池组分档存放；以下拉叠加变电站、组号、直流状态，以单体电压与内阻区间设门槛，
          数值取每档最近一次监测。内阻尺子由直流专责设定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="openRule">内阻尺子（直流专责）</button>
        <button class="btn" type="button" @click="exportRows">导出直流系统监测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在册蓄电池组</span>
        <strong class="stat-value">{{ query.diagnosis.total }} 组</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">符合当前条件</span>
        <strong class="stat-value hit">{{ query.total }} 组</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">监测中</span>
        <strong class="stat-value">{{ countByStatus('监测中') }} 组</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">异常告警</span>
        <strong class="stat-value danger">{{ countByStatus('异常告警') }} 组</strong>
      </article>
    </div>

    <form class="filter-bar dc-filter" @submit.prevent>
      <label class="filter-item">
        <span>所属变电站</span>
        <select v-model="filter.station">
          <option value="">全部变电站</option>
          <option v-for="station in facets.stations" :key="station" :value="station">{{ station }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>蓄电池组号</span>
        <select v-model="filter.groupKey">
          <option value="">全部组号</option>
          <option v-for="option in groupOptions" :key="option.key" :value="option.key">
            {{ option.label }}（{{ option.station }}）
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>直流状态</span>
        <select v-model="filter.status">
          <option value="">全部状态</option>
          <option v-for="status in facets.statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item range-item">
        <span>单体电压区间 (V)</span>
        <span class="range-inputs">
          <input v-model="filter.voltageMin" inputmode="decimal" placeholder="起，如 2.05" />
          <em>至</em>
          <input v-model="filter.voltageMax" inputmode="decimal" placeholder="止，如 2.18" />
        </span>
      </label>
      <label class="filter-item range-item">
        <span>内阻区间 (mΩ)</span>
        <span class="range-inputs">
          <input v-model="filter.resistanceMin" inputmode="decimal" placeholder="起，如 0.45" />
          <em>至</em>
          <input v-model="filter.resistanceMax" inputmode="decimal" placeholder="止，如 0.65" />
        </span>
      </label>
      <button class="btn ghost" type="button" @click="resetFilter">重置条件</button>
    </form>

    <p class="status-legend ruler-hint">
      <span class="legend-item">内阻尺子：＞{{ rule.maxMilliOhm }} {{ rule.unit }} 判超尺（{{ rule.updatedBy }} 设定于 {{ rule.updatedAt }}）</span>
      <span
        v-for="item in statusSummary"
        :key="item.status"
        class="legend-item"
        :class="{ 'legend-active': filter.status === item.status }"
      >
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="query.diagnosis.problems.length" class="diagnose-panel">
      <p v-for="problem in query.diagnosis.problems" :key="problem.field" class="diagnose-problem">
        ✗ {{ problem.message }}
      </p>
    </div>
    <div v-else-if="query.total === 0" class="diagnose-panel">
      <p class="diagnose-title">一格都没配上，卡窄的条件是：</p>
      <ul>
        <li v-for="blocker in query.diagnosis.blockers" :key="blocker.label">
          <strong>{{ blocker.label }}</strong>：{{ blocker.detail }}
        </li>
      </ul>
      <p v-if="query.conditions.length === 0" class="diagnose-title">暂无任何直流监测记录，请先登记或重置示例数据。</p>
    </div>
    <p v-else class="hit-line">
      符合条件的蓄电池组随手报：<strong>{{ query.total }}</strong> 组
      <span v-if="visibleGroups.length < query.total" class="muted">（已显示前 {{ visibleGroups.length }} 组）</span>
    </p>

    <table class="data-table dc-table">
      <thead>
        <tr>
          <th>所属变电站</th>
          <th>蓄电池组号</th>
          <th>最近监测日期</th>
          <th>单体电压 (V)</th>
          <th>内阻 (mΩ)</th>
          <th>监测人</th>
          <th>直流状态</th>
          <th>历史档数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in visibleGroups" :key="group.groupKey" :class="{ 'row-abnormal': group.latest.abnormal }">
          <td>{{ group.station }}</td>
          <td>{{ group.groupNo }}</td>
          <td>{{ group.latest.监测日期 }}</td>
          <td :class="{ 'metric-warn': isVoltageWarn(group.cellVoltage) }">
            {{ group.cellVoltage === null ? '—' : group.cellVoltage.toFixed(2) }}
          </td>
          <td :class="{ 'metric-warn': isResistanceOver(group.resistance) }">
            {{ group.resistance === null ? '—' : group.resistance.toFixed(3) }}
            <span v-if="isResistanceOver(group.resistance)" class="tag-warn">超尺</span>
          </td>
          <td>{{ group.latest.监测人 }}</td>
          <td>
            <span class="status-tag" :data-status="group.latest.status">{{ group.latest.status }}</span>
          </td>
          <td>{{ group.recordCount }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(group)">拉开明细</button>
            <button class="link danger-link" type="button" @click="markAbnormal(group)">标记异常</button>
          </td>
        </tr>
        <tr v-if="query.diagnosis.problems.length === 0 && query.total === 0">
          <td colspan="9" class="empty-state">没有符合条件的蓄电池组，请看上方诊断</td>
        </tr>
      </tbody>
    </table>

    <div v-if="visibleGroups.length < query.total" class="more-bar">
      <button class="btn" type="button" @click="visibleCount += PAGE_STEP">再显示 {{ Math.min(PAGE_STEP, query.total - visibleGroups.length) }} 组</button>
    </div>

    <footer class="page-foot">
      <span>共 {{ query.total }} / {{ query.diagnosis.total }} 组蓄电池（记录按组分档，列表数值取最近一次监测）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 明细抽屉：与列表同一份分档数据，首行即列表上看到的那次监测 -->
    <div v-if="detailGroup" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ detailGroup.station }} · {{ detailGroup.groupNo }} 监测明细</h3>
            <p class="page-desc">该档共 {{ detailHistory.length }} 次监测，按日期倒序；首行就是列表上的最近一次。</p>
          </div>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <table class="data-table">
          <thead>
            <tr>
              <th>监测日期</th>
              <th>单体电压 (V)</th>
              <th>内阻 (mΩ)</th>
              <th>监测人</th>
              <th>监测编号</th>
              <th>直流状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(record, idx) in detailHistory" :key="String(record.id)" :class="{ 'row-latest': idx === 0 }">
              <td>{{ record.监测日期 }}<span v-if="idx === 0" class="tag-latest">最近一次</span></td>
              <td :class="{ 'metric-warn': isVoltageWarn(toNum(record.单体电压)) }">{{ record.单体电压 }}</td>
              <td :class="{ 'metric-warn': isResistanceOver(toNum(record.内阻)) }">{{ record.内阻 }}</td>
              <td>{{ record.监测人 }}</td>
              <td>{{ record.监测编号 }}</td>
              <td>{{ record.直流状态 }}</td>
            </tr>
          </tbody>
        </table>
        <footer class="drawer-foot">
          <button class="btn primary" type="button" @click="markAbnormal(detailGroup)">标记异常（进巡视待复查清单）</button>
          <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
        </footer>
      </aside>
    </div>

    <!-- 内阻尺子：直流专责设定 -->
    <div v-if="ruleOpen" class="drawer-mask" @click.self="ruleOpen = false">
      <aside class="drawer rule-drawer">
        <header class="drawer-head">
          <div>
            <h3>内阻尺子设定</h3>
            <p class="page-desc">内阻告警上限由直流专责统一把握，保存后全页查询与超尺判断立即生效。</p>
          </div>
          <button class="btn ghost" type="button" @click="ruleOpen = false">关闭</button>
        </header>
        <div class="rule-form">
          <label class="filter-item">
            <span>内阻告警上限 (mΩ)</span>
            <input v-model="ruleDraft.maxMilliOhm" inputmode="decimal" placeholder="如 0.45" />
          </label>
          <label class="filter-item">
            <span>设定人（直流专责）</span>
            <input v-model="ruleDraft.updatedBy" placeholder="姓名" />
          </label>
          <p class="muted">现行：{{ rule.maxMilliOhm }} {{ rule.unit }}，{{ rule.updatedBy }} 设定于 {{ rule.updatedAt }}</p>
          <div class="rule-actions">
            <button class="btn primary" type="button" @click="saveRule">保存尺子</button>
            <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  buildDcGroups,
  downloadEntries,
  getDcFacets,
  getDcGroupHistory,
  getResistanceRuleView,
  moduleMeta,
  queryDcGroups,
  runAction as applyAction,
  saveResistanceRuleView,
} from '@/api/local-service'
import { emptyDcGroupFilter } from '@/data/dc-domain'
import type { DcGroup } from '@/data/dc-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dcsystem')
const PAGE_STEP = 50

const facets = ref(getDcFacets())
const filter = reactive(emptyDcGroupFilter())
const rule = ref(getResistanceRuleView())
const ruleOpen = ref(false)
const ruleDraft = reactive({ maxMilliOhm: String(rule.value.maxMilliOhm), updatedBy: rule.value.updatedBy })
const message = ref('')
const messageOk = ref(false)
const visibleCount = ref(PAGE_STEP)

const detailGroup = ref<DcGroup | null>(null)
const detailHistory = ref<EntryRow[]>([])

const query = computed(() => queryDcGroups(filter))
const visibleGroups = computed(() => query.value.groups.slice(0, visibleCount.value))

const groupOptions = computed(() => {
  const stations = filter.station ? [filter.station] : facets.value.stations
  return stations.flatMap((station) =>
    (facets.value.groupsByStation[station] ?? []).map((option) => ({ ...option, station })),
  )
})

const statusSummary = computed(() =>
  facets.value.statuses.map((status) => ({
    status,
    count: buildDcGroups().filter((group) => String(group.latest.status) === status).length,
  })),
)

// 变电站换了，原来选的组号可能不属于新站，跟着清掉。
watch(
  () => filter.station,
  () => {
    filter.groupKey = ''
  },
)
watch(
  query,
  () => {
    visibleCount.value = PAGE_STEP
  },
)

function countByStatus(status: string): number {
  return buildDcGroups().filter((group) => String(group.latest.status) === status).length
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isResistanceOver(value: number | null): boolean {
  return value !== null && value > rule.value.maxMilliOhm
}

function isVoltageWarn(value: number | null): boolean {
  return value !== null && (value < 2.18 || value > 2.28)
}

function resetFilter() {
  Object.assign(filter, emptyDcGroupFilter())
  flash('条件已重置')
}

function flash(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function exportRows() {
  downloadEntries(meta.key)
}

function refreshFacets() {
  facets.value = getDcFacets()
  rule.value = getResistanceRuleView()
}

function openDetail(group: DcGroup) {
  detailGroup.value = group
  detailHistory.value = getDcGroupHistory(group.groupKey)
}

function closeDetail() {
  detailGroup.value = null
  detailHistory.value = []
}

function markAbnormal(group: DcGroup) {
  message.value = ''
  const result = applyAction(meta.key, Number(group.latest.id), '标记异常')
  flash(result.message, result.ok)
  if (!result.ok) {
    return
  }
  refreshFacets()
  if (detailGroup.value?.groupKey === group.groupKey) {
    const refreshed = buildDcGroups().find((item) => item.groupKey === group.groupKey)
    if (refreshed) {
      openDetail(refreshed)
    }
  }
}

function openRule() {
  ruleDraft.maxMilliOhm = String(rule.value.maxMilliOhm)
  ruleDraft.updatedBy = rule.value.updatedBy
  ruleOpen.value = true
}

function saveRule() {
  const result = saveResistanceRuleView({
    maxMilliOhm: Number(ruleDraft.maxMilliOhm),
    updatedBy: ruleDraft.updatedBy,
  })
  flash(result.message, result.ok)
  if (result.ok) {
    refreshFacets()
    ruleOpen.value = false
  }
}

onMounted(() => {
  refreshFacets()
})
</script>
