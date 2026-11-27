<template>
  <section class="v3-card v4-dashboard-trend" aria-labelledby="v4-trend-title">
    <header>
      <h2 id="v4-trend-title">新增申请趋势</h2>
      <span class="v4-dash-range">最近 7 个月</span>
    </header>
    <p class="v3-dashboard-note">按申请记录 · 北京时间 · 自然月 · 本月截至统计业务日</p>
    <p v-if="loading" role="status">正在读取趋势…</p>
    <div v-else-if="error" role="status">
      <p>{{ error }}</p>
      <button type="button" @click="$emit('retry')">重试历史统计</button>
    </div>
    <template v-else-if="trend">
      <p v-if="trend.coverage === 'partial'" class="v3-dashboard-note" role="status">
        部分覆盖：存在不可归月的申请或未纳入的旧档，未知月份显示「—」。
      </p>
      <ol class="v4-dash-bars" aria-label="按月申请记录">
        <li v-for="month in trend.months" :key="month.month">
          <span
            v-if="month.count !== null && month.count !== peak"
            class="v4-dash-stripe"
            aria-hidden="true"
          />
          <button
            type="button"
            class="v4-dash-bar-point"
            :aria-label="monthLabel(month.month) + '：' + valueLabel(month.count)"
            :style="{ '--bar-ratio': barRatio(month.count, peak) }"
          >
            <span
              class="v4-dash-value"
              :class="{ 'is-peak': peak > 0 && month.count === peak }"
              :title="String(month.count ?? '未知')"
              >{{ month.count ?? '—' }}</span
            >
            <span class="v4-dash-bar-fill" aria-hidden="true" />
            <span class="v4-dash-tip" aria-hidden="true"
              >{{ monthLabel(month.month) }} · {{ valueLabel(month.count) }}</span
            >
          </button>
          <span class="v4-dash-month">{{ Number(month.month.slice(5)) }}月</span>
        </li>
      </ol>
    </template>
    <p v-else>趋势暂不可用。</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { barRatio, type HistoryMetrics } from '../api/dashboard-v3'
const props = defineProps<{
  trend?: HistoryMetrics['applications']
  loading: boolean
  error: string
}>()
defineEmits<{ retry: [] }>()
const peak = computed(() =>
  Math.max(0, ...(props.trend?.months ?? []).map((row) => row.count ?? 0))
)
const monthLabel = (value: string) => value.slice(0, 4) + ' 年 ' + Number(value.slice(5)) + ' 月'
const valueLabel = (count: number | null) => (count === null ? '未知' : count + ' 条申请记录')
</script>
