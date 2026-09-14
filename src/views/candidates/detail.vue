<template>
  <div class="candidate-detail">
    <!-- 加载中 -->
    <div v-if="detailLoading" class="loading-card">
      <el-skeleton :rows="8" animated />
    </div>

    <!-- 正常详情 -->
    <template v-else-if="candidate">
      <div class="page-header">
        <div>
          <el-button link type="primary" @click="goBack"> ← 返回候选人列表 </el-button>

          <h2>
            {{ candidate.name }}
          </h2>

          <p>
            {{ candidate.position }}
          </p>
        </div>

        <el-tag :type="getStageTagType(candidate.stage)">
          {{ getStageLabel(candidate.stage) }}
        </el-tag>
      </div>

      <el-row :gutter="16">
        <el-col :xs="24" :lg="16">
          <div class="detail-card">
            <h3>基本信息</h3>

            <el-descriptions :column="2" border>
              <el-descriptions-item label="姓名">
                {{ candidate.name }}
              </el-descriptions-item>

              <el-descriptions-item label="应聘职位">
                {{ candidate.position }}
              </el-descriptions-item>

              <el-descriptions-item label="学历">
                {{ candidate.education }}
              </el-descriptions-item>

              <el-descriptions-item label="毕业院校">
                {{ candidate.school }}
              </el-descriptions-item>

              <el-descriptions-item label="手机号">
                {{ candidate.phone }}
              </el-descriptions-item>

              <el-descriptions-item label="邮箱">
                {{ candidate.email }}
              </el-descriptions-item>

              <el-descriptions-item label="负责人">
                {{ candidate.owner }}
              </el-descriptions-item>

              <el-descriptions-item label="投递日期">
                {{ candidate.appliedDate }}
              </el-descriptions-item>
            </el-descriptions>
          </div>

          <div class="detail-card">
            <h3>技能</h3>

            <p>
              {{ candidate.skills || '暂无技能信息' }}
            </p>
          </div>

          <div class="detail-card">
            <h3>项目 / 工作经历</h3>

            <p>
              {{ candidate.experience || '暂无经历信息' }}
            </p>
          </div>

          <div class="detail-card">
            <h3>招聘备注</h3>

            <p>
              {{ candidate.note || '暂无备注' }}
            </p>
          </div>
        </el-col>

        <el-col :xs="24" :lg="8">
          <div class="detail-card">
            <h3>招聘进度</h3>

            <el-timeline>
              <el-timeline-item timestamp="简历投递" type="primary">
                {{ candidate.appliedDate }}
              </el-timeline-item>

              <el-timeline-item v-if="stageLevel >= 1" timestamp="简历筛选" type="success">
                已通过筛选
              </el-timeline-item>

              <el-timeline-item v-if="stageLevel >= 2" timestamp="初面" type="success">
                已进入初面阶段
              </el-timeline-item>

              <el-timeline-item v-if="stageLevel >= 3" timestamp="复面" type="success">
                已进入复面阶段
              </el-timeline-item>

              <el-timeline-item v-if="candidate.stage === 'offer'" timestamp="Offer" type="success">
                已发放 Offer
              </el-timeline-item>

              <el-timeline-item
                v-if="candidate.stage === 'rejected'"
                timestamp="流程结束"
                type="danger"
              >
                候选人已淘汰
              </el-timeline-item>
            </el-timeline>
          </div>
        </el-col>
      </el-row>
    </template>

    <!-- 请求失败 -->
    <el-result
      v-else-if="loadError"
      icon="error"
      title="候选人加载失败"
      sub-title="无法获取候选人信息，请检查 Mock API 是否正常运行"
    >
      <template #extra>
        <el-button type="primary" @click="loadCandidateDetail"> 重新加载 </el-button>

        <el-button @click="goBack"> 返回候选人列表 </el-button>
      </template>
    </el-result>

    <!-- 不存在 -->
    <el-result
      v-else
      icon="warning"
      title="未找到候选人"
      sub-title="该候选人可能不存在、已被删除或地址参数无效"
    >
      <template #extra>
        <el-button type="primary" @click="goBack"> 返回候选人列表 </el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'

import { useCandidateStore } from '@/store/modules/candidate'

import type { CandidateStage } from '@/types/candidate'

const route = useRoute()
const router = useRouter()

const candidateStore = useCandidateStore()

const detailLoading = ref(false)

const loadError = ref(false)

const candidateId = computed(() => {
  return Number(route.params.id)
})

const candidate = computed(() => {
  return candidateStore.getCandidateById(candidateId.value)
})

const loadCandidateDetail = async () => {
  loadError.value = false

  const id = candidateId.value

  if (!Number.isInteger(id) || id <= 0) {
    return
  }

  detailLoading.value = true

  try {
    await candidateStore.fetchCandidateById(id)
  } catch (error) {
    console.error('候选人详情加载失败：', error)

    loadError.value = true
  } finally {
    detailLoading.value = false
  }
}

watch(
  candidateId,
  () => {
    loadCandidateDetail()
  },
  {
    immediate: true
  }
)

const stageLevel = computed(() => {
  if (!candidate.value) {
    return 0
  }

  const levels: Record<CandidateStage, number> = {
    screening: 1,
    first_interview: 2,
    second_interview: 3,
    offer: 4,
    rejected: 1
  }

  return levels[candidate.value.stage]
})

const getStageLabel = (stage: CandidateStage) => {
  const labels: Record<CandidateStage, string> = {
    screening: '筛选中',
    first_interview: '初面',
    second_interview: '复面',
    offer: 'Offer',
    rejected: '已淘汰'
  }

  return labels[stage]
}

const getStageTagType = (stage: CandidateStage) => {
  const types = {
    screening: 'info',
    first_interview: 'warning',
    second_interview: 'primary',
    offer: 'success',
    rejected: 'danger'
  } as const

  return types[stage]
}

const goBack = () => {
  router.push('/candidates')
}
</script>

<style scoped lang="scss">
.candidate-detail {
  width: 100%;
}

.loading-card,
.detail-card {
  padding: 20px;
  margin-bottom: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 10px 0 6px;
  font-size: 24px;
}

.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
}

.detail-card h3 {
  margin: 0 0 18px;
  font-size: 16px;
}

.detail-card p {
  margin: 0;
  color: var(--el-text-color-regular);
  line-height: 1.8;
}
</style>
