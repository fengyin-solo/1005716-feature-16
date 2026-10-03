<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="review-block">
      <header class="review-head">
        <h3>直流异常蓄电池组 · 待复查清单</h3>
        <p class="page-desc">直流监测里标成异常的组会进这张单子；同一组反复上报只刷新、不长出第二条，复查后移出待办。</p>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>所属变电站</th>
            <th>蓄电池组号</th>
            <th>最近监测日期</th>
            <th>单体电压 (V)</th>
            <th>内阻 (mΩ)</th>
            <th>上报原因</th>
            <th>上报时间</th>
            <th>复查操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in pendingReviews" :key="`review-${item.id}`" class="row-abnormal">
            <td>{{ item.station }}</td>
            <td>{{ item.groupNo }}</td>
            <td>{{ item.latestDate }}</td>
            <td>{{ item.cellVoltage }}</td>
            <td>{{ item.resistance }}</td>
            <td>{{ item.reason }}</td>
            <td>{{ item.reportedAt }}</td>
            <td class="row-actions">
              <input v-model="reviewerDraft[item.id]" class="review-input" placeholder="复查人" />
              <button class="link" type="button" @click="completeReview(item.id)">确认复查</button>
            </td>
          </tr>
          <tr v-if="!pendingReviews.length">
            <td colspan="8" class="empty-state">待复查清单是空的，直流侧标记异常的蓄电池组会进到这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设备巡视数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listDcPendingReviews,
  listEntries,
  moduleMeta,
  resolveDcReview,
  runAction as applyAction,
} from '@/api/local-service'
import type { DcReviewItem } from '@/data/dc-domain'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = ["待巡视", "巡视中", "已完成", "已上报"]
const stats = [{"label": "待巡视站点", "value": 0}, {"label": "已完成巡视", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const pendingReviews = ref<DcReviewItem[]>([])
const reviewerDraft = reactive<Record<number, string>>({})
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function loadReviews() {
  pendingReviews.value = listDcPendingReviews()
}

function completeReview(id: number) {
  errorMessage.value = ''
  const reviewer = (reviewerDraft[id] ?? '').trim() || '值班管理员'
  const result = resolveDcReview(id, reviewer)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  delete reviewerDraft[id]
  loadReviews()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(() => {
  reload()
  loadReviews()
})
</script>
