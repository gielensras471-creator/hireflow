<template>
  <div class="dashboard">
    <!-- 数据概览 -->
    <el-row :gutter="16">
      <el-col
        v-for="item in statistics"
        :key="item.key"
        :xs="24"
        :sm="12"
        :lg="6"
      >
        <div class="stat-card">
          <div class="stat-card__header">
            <span>{{ item.title }}</span>
            <span class="stat-card__trend">{{ item.trend }}</span>
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
            <CandidateTrendChart />
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
            <StageDistributionChart />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 今日面试 -->
    <div class="dashboard-panel">
      <div class="panel-header">
        <div>
          <h3>今日面试</h3>
          <p>今天需要跟进的面试安排</p>
        </div>

        <el-button type="primary" plain @click="goToInterviews">
          查看全部
        </el-button>
      </div>

      <el-table :data="todayInterviews">
        <el-table-column
          prop="candidate"
          label="候选人"
          min-width="120"
        />

        <el-table-column
          prop="position"
          label="应聘职位"
          min-width="180"
        />

        <el-table-column
          prop="time"
          label="面试时间"
          width="120"
        />

        <el-table-column
          prop="interviewer"
          label="面试官"
          width="120"
        />

        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag
              :type="row.status === '待面试' ? 'warning' : 'success'"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import CandidateTrendChart from './components/CandidateTrendChart.vue'
import StageDistributionChart from './components/StageDistributionChart.vue'

const router = useRouter()

const statistics = [
  {
    key: 'positions',
    title: '开放职位',
    value: 8,
    trend: '+2',
    description: '当前正在招聘的职位'
  },
  {
    key: 'candidates',
    title: '候选人数',
    value: 126,
    trend: '+18',
    description: '当前人才库候选人'
  },
  {
    key: 'interviews',
    title: '今日面试',
    value: 5,
    trend: '今日',
    description: '今天安排的面试'
  },
  {
    key: 'pending',
    title: '待处理',
    value: 12,
    trend: '待跟进',
    description: '等待处理的候选人'
  }
]

const todayInterviews = [
  {
    candidate: '陈晓',
    position: '前端开发工程师',
    time: '10:00',
    interviewer: '张经理',
    status: '待面试'
  },
  {
    candidate: '林悦',
    position: 'UI 设计师',
    time: '14:00',
    interviewer: '李主管',
    status: '待面试'
  },
  {
    candidate: '王晨',
    position: '产品助理',
    time: '16:30',
    interviewer: '赵经理',
    status: '已完成'
  }
]

const goToInterviews = () => {
  router.push('/interviews')
}
</script>

<style scoped lang="scss">
.dashboard {
  width: 100%;
}

.dashboard-row {
  margin-top: 16px;
}

.stat-card {
  min-height: 140px;
  padding: 20px;
  margin-bottom: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  box-sizing: border-box;
}

.stat-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.stat-card__trend {
  color: var(--el-color-primary);
  font-size: 13px;
}

.stat-card__value {
  margin: 16px 0 10px;
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
}

.stat-card__description {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.dashboard-panel {
  padding: 20px;
  margin-bottom: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.panel-header h3 {
  margin: 0 0 6px;
  font-size: 16px;
}

.panel-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.chart-wrapper {
  height: 320px;
}

@media (max-width: 768px) {
  .chart-wrapper {
    height: 280px;
  }
}
</style>
