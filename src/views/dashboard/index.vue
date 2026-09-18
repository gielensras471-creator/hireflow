<template>
  <div class="dashboard" v-loading="loading">
    <!-- 请求失败 -->
    <div v-if="loadError" class="error-state">
      <el-alert
        title="工作台数据加载失败"
        description="请确认 Express API 是否正常运行。"
        type="error"
        show-icon
        :closable="false"
      />

      <el-button type="primary" :loading="loading" @click="loadDashboard"> 重新加载 </el-button>
    </div>

    <template v-else>
      <!-- 数据概览 -->
      <el-row :gutter="16">
        <el-col v-for="item in statistics" :key="item.key" :xs="24" :sm="12" :lg="6">
          <div class="stat-card">
            <div class="stat-card__header">
              <span>
                {{ item.title }}
              </span>

              <span class="stat-card__trend">
                {{ item.trend }}
              </span>
            </div>

            <div class="stat-card__value">
              {{ item.value }}
            </div>

            <div class="stat-card__description">
              {{ item.description }}
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- 图表 -->
      <el-row :gutter="16" class="dashboard-row">
        <el-col :xs="24" :lg="14">
          <div class="dashboard-panel">
            <div class="panel-header">
              <div>
                <h3>候选人趋势</h3>

                <p>近 7 日新增候选人数量</p>
              </div>
            </div>

            <div class="chart-wrapper">
              <CandidateTrendChart
                :labels="candidateTrend.labels"
                :values="candidateTrend.values"
              />
            </div>
          </div>
        </el-col>

        <el-col :xs="24" :lg="10">
          <div class="dashboard-panel">
            <div class="panel-header">
              <div>
                <h3>招聘阶段分布</h3>

                <p>当前候选人的招聘进度</p>
              </div>
            </div>

            <div class="chart-wrapper">
              <StageDistributionChart :data="stageDistribution" />
            </div>
          </div>
        </el-col>
      </el-row>

      <!-- 今日面试 -->
      <div class="dashboard-panel">
        <div class="panel-header">
          <div>
            <h3>今日面试</h3>

            <p>今天的面试安排与进度</p>
          </div>

          <el-button type="primary" plain @click="goToInterviews"> 查看全部 </el-button>
        </div>

        <el-table :data="todayInterviews" row-key="id" empty-text="今天暂无面试安排">
          <el-table-column prop="candidateName" label="候选人" min-width="120" />

          <el-table-column prop="position" label="应聘职位" min-width="180" />

          <el-table-column prop="time" label="面试时间" width="120" />

          <el-table-column prop="type" label="面试轮次" width="110" />

          <el-table-column prop="interviewer" label="面试官" width="120" />

          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="getInterviewStatusType(row.status)">
                {{ getInterviewStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useRouter } from 'vue-router'

import { getDashboardDataApi } from '@/api/modules/dashboard'

import CandidateTrendChart from './components/CandidateTrendChart.vue'
import StageDistributionChart from './components/StageDistributionChart.vue'

import type { Position } from '@/types/position'

import type { Candidate, CandidateStage } from '@/types/candidate'

import type { Interview, InterviewStatus } from '@/types/interview'

const router = useRouter()

const positions = ref<Position[]>([])

const candidates = ref<Candidate[]>([])

const interviews = ref<Interview[]>([])

const loading = ref(false)

const loadError = ref(false)

/* =========================
   日期工具
========================= */

const formatDate = (date: Date) => {
  const year = date.getFullYear()

  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const formatMonthDay = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${month}-${day}`
}

/* =========================
   加载 Dashboard 数据
========================= */

const loadDashboard = async () => {
  loading.value = true
  loadError.value = false

  try {
    const data = await getDashboardDataApi()

    positions.value = data.positions

    candidates.value = data.candidates

    interviews.value = data.interviews
  } catch (error) {
    console.error('Dashboard 数据加载失败：', error)

    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadDashboard()
})

/* =========================
   今天
========================= */

const today = computed(() => {
  return formatDate(new Date())
})

/* =========================
   统计卡
========================= */

const openPositionCount = computed(() => {
  return positions.value.filter((item) => item.status === 'open').length
})

const closedPositionCount = computed(() => {
  return positions.value.filter((item) => item.status === 'closed').length
})

const screeningCount = computed(() => {
  return candidates.value.filter((item) => item.stage === 'screening').length
})

const scheduledInterviewCount = computed(() => {
  return interviews.value.filter((item) => item.status === 'scheduled').length
})

const todayInterviews = computed(() => {
  return interviews.value
    .filter((item) => item.date === today.value)
    .sort((a, b) => a.time.localeCompare(b.time))
})

const todayScheduledCount = computed(() => {
  return todayInterviews.value.filter((item) => item.status === 'scheduled').length
})

const pendingCount = computed(() => {
  return screeningCount.value + scheduledInterviewCount.value
})

const statistics = computed(() => [
  {
    key: 'positions',
    title: '开放职位',

    value: openPositionCount.value,

    trend: `${closedPositionCount.value} 已关闭`,

    description: '当前正在招聘的职位'
  },

  {
    key: 'candidates',
    title: '候选人数',

    value: candidates.value.length,

    trend: `${screeningCount.value} 待筛选`,

    description: '当前人才库候选人'
  },

  {
    key: 'interviews',
    title: '今日面试',

    value: todayInterviews.value.length,

    trend: `${todayScheduledCount.value} 待进行`,

    description: '今天安排的面试'
  },

  {
    key: 'pending',
    title: '待处理',

    value: pendingCount.value,

    trend: '需跟进',

    description: '待筛选候选人及待面试事项'
  }
])

/* =========================
   近 7 日候选人趋势
========================= */

const candidateTrend = computed(() => {
  const days: {
    key: string
    label: string
  }[] = []

  for (let i = 6; i >= 0; i--) {
    const date = new Date()

    /*
     * 固定在中午计算日期，
     * 避免部分时区边界问题。
     */
    date.setHours(12, 0, 0, 0)

    date.setDate(date.getDate() - i)

    days.push({
      key: formatDate(date),

      label: formatMonthDay(date)
    })
  }

  return {
    labels: days.map((item) => item.label),

    values: days.map(
      (day) => candidates.value.filter((candidate) => candidate.appliedDate === day.key).length
    )
  }
})

/* =========================
   招聘阶段分布
========================= */

const countStage = (stage: CandidateStage) => {
  return candidates.value.filter((candidate) => candidate.stage === stage).length
}

const stageDistribution = computed(() => [
  {
    name: '筛选中',
    value: countStage('screening')
  },

  {
    name: '初面',
    value: countStage('first_interview')
  },

  {
    name: '复面',
    value: countStage('second_interview')
  },

  {
    name: 'Offer',
    value: countStage('offer')
  },

  {
    name: '已淘汰',
    value: countStage('rejected')
  }
])

/* =========================
   面试状态
========================= */

const getInterviewStatusLabel = (status: InterviewStatus) => {
  const labels: Record<InterviewStatus, string> = {
    scheduled: '待面试',
    completed: '已完成',
    cancelled: '已取消'
  }

  return labels[status]
}

const getInterviewStatusType = (status: InterviewStatus) => {
  const types = {
    scheduled: 'warning',
    completed: 'success',
    cancelled: 'info'
  } as const

  return types[status]
}

/* =========================
   跳转
========================= */

const goToInterviews = () => {
  router.push('/interviews')
}
</script>

<style scoped lang="scss">
.dashboard {
  width: 100%;
  min-height: 400px;
}

.error-state {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .el-button {
    align-self: flex-start;
  }
}

.dashboard-row {
  margin-top: 4px;
}

/* =====================
   数据统计卡片
===================== */

.stat-card {
  position: relative;
  box-sizing: border-box;
  min-height: 132px;
  padding: 20px 20px 18px;
  margin-bottom: 16px;
  overflow: hidden;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;

  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;

  &::before {
    position: absolute;
    top: 0;
    left: 20px;

    width: 34px;
    height: 3px;

    content: '';

    background: var(--el-color-primary);

    border-radius: 0 0 3px 3px;

    opacity: 0.9;
  }

  &:hover {
    border-color: var(--el-color-primary-light-7);

    box-shadow: 0 8px 24px rgb(31 35 48 / 6%);

    transform: translateY(-2px);
  }
}

.stat-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  color: var(--el-text-color-secondary);

  font-size: 13px;
}

.stat-card__trend {
  padding: 3px 7px;

  color: var(--el-color-primary);

  font-size: 12px;

  background: var(--el-color-primary-light-9);

  border-radius: 6px;
}

.stat-card__value {
  margin: 18px 0 9px;

  color: var(--el-text-color-primary);

  font-size: 32px;
  font-weight: 700;
  line-height: 1;

  letter-spacing: -0.8px;
}

.stat-card__description {
  color: var(--el-text-color-secondary);

  font-size: 12px;
}

/* =====================
   Dashboard 内容卡
===================== */

.dashboard-panel {
  box-sizing: border-box;
  padding: 20px 22px;
  margin-bottom: 16px;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;

  transition: box-shadow 0.2s ease;

  &:hover {
    box-shadow: 0 8px 26px rgb(31 35 48 / 4%);
  }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;

  margin-bottom: 12px;
}

.panel-header h3 {
  margin: 0 0 5px;

  color: var(--el-text-color-primary);

  font-size: 15px;
  font-weight: 650;
}

.panel-header p {
  margin: 0;

  color: var(--el-text-color-secondary);

  font-size: 12px;
}

/* =====================
   图表
===================== */

.chart-wrapper {
  height: 300px;
}

/* =====================
   今日面试表格
===================== */

.dashboard-panel {
  :deep(.el-table) {
    --el-table-border-color: var(--el-border-color-lighter);

    --el-table-header-bg-color: transparent;

    background: transparent;

    &::before {
      display: none;
    }

    th.el-table__cell {
      height: 42px;

      color: var(--el-text-color-secondary);

      font-size: 12px;
      font-weight: 500;

      background: transparent;
    }

    td.el-table__cell {
      height: 46px;

      color: var(--el-text-color-regular);
    }
  }
}

@media (max-width: 1200px) {
  .chart-wrapper {
    height: 280px;
  }
}

@media (max-width: 768px) {
  .stat-card {
    min-height: 120px;
  }

  .dashboard-panel {
    padding: 18px 16px;
  }

  .chart-wrapper {
    height: 260px;
  }
}
</style>
