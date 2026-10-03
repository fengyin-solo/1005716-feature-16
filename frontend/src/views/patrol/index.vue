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

    <!-- 直流系统监测标记异常的蓄电池组进这里：同一组反复上报只保留一条 -->
    <section class="recheck-card">
      <header class="recheck-head">
        <h3>直流异常 · 待复查清单</h3>
        <span class="recheck-tip">由直流系统监测「标记异常」自动转入；同一组蓄电池反复上报不重复建档</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>复查编号</th>
            <th>所属变电站</th>
            <th>蓄电池组号</th>
            <th>单体电压 (V)</th>
            <th>内阻 (mΩ)</th>
            <th>监测编号</th>
            <th>上报日期</th>
            <th>复查情况</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in recheckRows" :key="String(row.id)" :class="{ 'row-done': row.巡视状态 === '已复查' }">
            <td>{{ row.巡视编号 }}</td>
            <td>{{ row.巡视变电站 }}</td>
            <td>{{ row.recheckGroupNo }}</td>
            <td>{{ row.recheckVoltage === '' ? '—' : Number(row.recheckVoltage).toFixed(2) }}</td>
            <td>{{ row.recheckResistance === '' ? '—' : Number(row.recheckResistance).toFixed(2) }}</td>
            <td>{{ row.recheckCode }}</td>
            <td>{{ row.巡视日期 }}</td>
            <td>
              <span class="recheck-state" :data-state="String(row.巡视状态)">{{ row.巡视状态 }}</span>
            </td>
            <td class="row-actions">
              <button
                v-if="row.巡视状态 !== '已复查'"
                class="link"
                type="button"
                @click="finishRecheck(row)"
              >
                登记复查
              </button>
              <span v-else class="recheck-done">已完成复查</span>
            </td>
          </tr>
          <tr v-if="!recheckRows.length">
            <td colspan="9" class="empty-state">暂无直流异常待复查项，在直流系统监测里标记异常后会自动转来</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend" style="margin-top: 14px">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <td :colspan="columns.length + 2" class="empty-state">暂无人工登记的巡视记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条巡视记录（直流待复查 {{ recheckRows.length }} 条单列于上方）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listRows } from '@/data/local-store'
import { completeRecheck, listRecheckEntries, syncRecheckFromGroups } from '@/api/dc-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = ["待巡视", "巡视中", "已完成", "已上报"]
const stats = [{"label": "待巡视站点", "value": 0}, {"label": "已完成巡视", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const recheckRows = ref<EntryRow[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 人工巡视表不含直流联动转入的行，那些统一在上方待复查清单里管理
function manualRows(): EntryRow[] {
  return listRows(meta.key).filter((row) => !row.recheckKey)
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function finishRecheck(row: EntryRow) {
  errorMessage.value = ''
  const result = completeRecheck(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 进入巡视页再对一次账，保证直流侧新标的异常不漏进清单
    syncRecheckFromGroups()
    rows.value = filterRows(manualRows(), filters.value)
    recheckRows.value = listRecheckEntries()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.recheck-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.recheck-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.recheck-head h3 { margin: 0; font-size: 15px; }
.recheck-tip { font-size: 12px; color: var(--muted); }
.recheck-state { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.recheck-state[data-state='待复查'] { background: #fde8e6; color: #b42318; }
.recheck-state[data-state='已复查'] { background: #e7f6ec; color: #1a7f37; }
.row-done { color: var(--muted); }
.recheck-done { font-size: 12px; color: var(--muted); }
</style>
