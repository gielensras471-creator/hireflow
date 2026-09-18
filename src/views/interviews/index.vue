<template>
  <div class="interview-page">
    <div class="page-header">
      <div>
        <h2>面试管理</h2>
        <p>统一管理候选人的面试安排与面试状态</p>
      </div>
    </div>

    <!-- 搜索筛选 -->
    <div class="filter-card">
      <el-input v-model="keyword" placeholder="搜索候选人姓名" clearable class="search-input" />

      <el-select v-model="statusFilter" placeholder="面试状态" clearable class="filter-select">
        <el-option label="待面试" value="scheduled" />

        <el-option label="已完成" value="completed" />

        <el-option label="已取消" value="cancelled" />
      </el-select>

      <el-date-picker
        v-model="dateFilter"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="面试日期"
        clearable
        class="date-picker"
      />
    </div>

    <!-- 表格 -->
    <div class="table-card">
      <!-- 加载失败 -->
      <div v-if="error" class="error-state">
        <el-alert
          title="面试数据加载失败"
          description="请确认 Express API 是否正常运行。"
          type="error"
          show-icon
          :closable="false"
        />

        <el-button type="primary" :loading="loading" @click="loadInterviews"> 重新加载 </el-button>
      </div>

      <template v-else>
        <el-table
          v-loading="loading"
          :data="pagedInterviews"
          row-key="id"
          empty-text="暂无符合条件的面试安排"
        >
          <el-table-column prop="candidateName" label="候选人" min-width="110" />

          <el-table-column prop="position" label="应聘职位" min-width="170" />

          <el-table-column prop="date" label="面试日期" width="120" />

          <el-table-column prop="time" label="时间" width="90" />

          <el-table-column prop="type" label="面试轮次" width="100" />

          <el-table-column prop="interviewer" label="面试官" width="110" />

          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)">
                {{ getStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />

          <el-table-column label="操作" width="270" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'scheduled'">
                <el-button
                  link
                  type="primary"
                  :disabled="operatingId === row.id"
                  @click="handleEdit(row)"
                >
                  编辑
                </el-button>

                <el-button
                  link
                  type="success"
                  :loading="operatingId === row.id && operatingType === 'complete'"
                  :disabled="operatingId === row.id && operatingType !== 'complete'"
                  @click="handleComplete(row)"
                >
                  完成
                </el-button>

                <el-button
                  link
                  type="warning"
                  :loading="operatingId === row.id && operatingType === 'cancel'"
                  :disabled="operatingId === row.id && operatingType !== 'cancel'"
                  @click="handleCancel(row)"
                >
                  取消
                </el-button>
              </template>

              <el-button
                link
                type="primary"
                :disabled="operatingId === row.id"
                @click="handleViewCandidate(row)"
              >
                候选人
              </el-button>

              <el-button
                link
                type="danger"
                :loading="operatingId === row.id && operatingType === 'delete'"
                :disabled="operatingId === row.id && operatingType !== 'delete'"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pagination">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            layout="total, prev, pager, next"
            :total="filteredInterviews.length"
          />
        </div>
      </template>
    </div>

    <InterviewDialog
      v-model="editDialogVisible"
      :interview="editingInterview"
      :submitting="submitting"
      @submit="handleSubmitEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useRouter } from 'vue-router'

import { storeToRefs } from 'pinia'

import { ElMessage, ElMessageBox } from 'element-plus'

import { useInterviewStore } from '@/stores/interview'

import { useCandidateStore } from '@/stores/candidate'

import { getInterviewCompletionNextStage } from '@/config/recruitment'

import InterviewDialog from '@/views/candidates/components/InterviewDialog.vue'

import type { Interview, InterviewFormData, InterviewStatus } from '@/types/interview'

const router = useRouter()

const interviewStore = useInterviewStore()

const candidateStore = useCandidateStore()

const { interviews, loading, error } = storeToRefs(interviewStore)

/* =========================
   页面请求
========================= */

const submitting = ref(false)

const operatingId = ref<number | null>(null)

const operatingType = ref<'complete' | 'cancel' | 'delete' | null>(null)

const loadInterviews = async () => {
  try {
    await interviewStore.fetchInterviews(true)
  } catch (error) {
    console.error('面试列表加载失败：', error)
  }
}

onMounted(() => {
  loadInterviews()
})

/* =========================
   编辑
========================= */

const editDialogVisible = ref(false)

const editingInterview = ref<Interview | null>(null)

const handleEdit = (interview: Interview) => {
  editingInterview.value = {
    ...interview
  }

  editDialogVisible.value = true
}

const handleSubmitEdit = async (data: InterviewFormData) => {
  if (!editingInterview.value || submitting.value) {
    return
  }

  submitting.value = true

  try {
    await interviewStore.updateInterview(editingInterview.value.id, data)

    editDialogVisible.value = false

    ElMessage.success('面试安排修改成功')
  } catch (error) {
    console.error('面试安排修改失败：', error)

    ElMessage.error('面试安排修改失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/* =========================
   搜索 / 筛选 / 分页
========================= */

const keyword = ref('')

const statusFilter = ref<InterviewStatus | ''>('scheduled')

const dateFilter = ref('')

const currentPage = ref(1)

const pageSize = ref(5)

const filteredInterviews = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()

  return interviews.value.filter((item) => {
    const matchKeyword = item.candidateName.toLowerCase().includes(normalizedKeyword)

    const matchStatus = !statusFilter.value || item.status === statusFilter.value

    const matchDate = !dateFilter.value || item.date === dateFilter.value

    return matchKeyword && matchStatus && matchDate
  })
})

const pagedInterviews = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value

  const end = start + pageSize.value

  return filteredInterviews.value.slice(start, end)
})

watch([keyword, statusFilter, dateFilter], () => {
  currentPage.value = 1
})

/* =========================
   状态显示
========================= */

const getStatusLabel = (status: InterviewStatus) => {
  const labels: Record<InterviewStatus, string> = {
    scheduled: '待面试',
    completed: '已完成',
    cancelled: '已取消'
  }

  return labels[status]
}

const getStatusType = (status: InterviewStatus) => {
  const types = {
    scheduled: 'warning',
    completed: 'success',
    cancelled: 'info'
  } as const

  return types[status]
}

/* =========================
   查看候选人
========================= */

const handleViewCandidate = (interview: Interview) => {
  router.push(`/candidates/${interview.candidateId}`)
}

/* =========================
   完成面试
========================= */

const handleComplete = async (interview: Interview) => {
  try {
    await ElMessageBox.confirm(
      `确定将 ${interview.candidateName} 的${interview.type}标记为已完成吗？`,
      '完成面试',
      {
        confirmButtonText: '确定完成',

        cancelButtonText: '取消',

        type: 'success'
      }
    )
  } catch {
    return
  }

  operatingId.value = interview.id

  operatingType.value = 'complete'

  try {
    await interviewStore.updateInterviewStatus(interview.id, 'completed')

    /*
     * 用户可能直接进入面试页，
     * Candidate Store 此时可能还没有数据。
     *
     * 所以主动获取候选人详情。
     */
    const candidate = await candidateStore.fetchCandidateById(interview.candidateId)

    /*
     * 初面完成：
     * first_interview
     * → second_interview
     */
    const nextStage = getInterviewCompletionNextStage(candidate.stage, interview.type)

    if (nextStage) {
      await candidateStore.updateCandidateStage(candidate.id, nextStage)
    }

    ElMessage.success('面试已完成，候选人流程已同步更新')
  } catch (error) {
    console.error('完成面试失败：', error)

    ElMessage.error('操作失败，请稍后重试')
  } finally {
    operatingId.value = null
    operatingType.value = null
  }
}

/* =========================
   取消面试
========================= */

const handleCancel = async (interview: Interview) => {
  try {
    await ElMessageBox.confirm(
      `确定取消 ${interview.candidateName} 的${interview.type}吗？`,
      '取消面试',
      {
        confirmButtonText: '确定取消',

        cancelButtonText: '返回',

        type: 'warning'
      }
    )
  } catch {
    return
  }

  operatingId.value = interview.id

  operatingType.value = 'cancel'

  try {
    await interviewStore.updateInterviewStatus(interview.id, 'cancelled')

    ElMessage.success('面试已取消')
  } catch (error) {
    console.error('取消面试失败：', error)

    ElMessage.error('取消面试失败，请稍后重试')
  } finally {
    operatingId.value = null
    operatingType.value = null
  }
}

/* =========================
   删除面试
========================= */

const handleDelete = async (interview: Interview) => {
  try {
    await ElMessageBox.confirm(
      `确定删除 ${interview.candidateName} 的面试记录吗？`,
      '删除面试记录',
      {
        confirmButtonText: '删除',

        cancelButtonText: '取消',

        type: 'warning'
      }
    )
  } catch {
    return
  }

  operatingId.value = interview.id

  operatingType.value = 'delete'

  try {
    await interviewStore.removeInterview(interview.id)

    if (pagedInterviews.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }

    ElMessage.success('面试记录已删除')
  } catch (error) {
    console.error('删除面试记录失败：', error)

    ElMessage.error('删除面试记录失败，请稍后重试')
  } finally {
    operatingId.value = null
    operatingType.value = null
  }
}
</script>

<style scoped lang="scss">
.interview-page {
  width: 100%;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.page-header h2 {
  margin: 0 0 5px;
  color: var(--el-text-color-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}

.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

/* 筛选 */

.filter-card {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px 18px;
  margin-bottom: 14px;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;
}

.search-input {
  width: 280px;
}

.filter-select {
  width: 160px;
}

.date-picker {
  width: 180px;
}

.filter-card :deep(.el-input__wrapper),
.filter-card :deep(.el-select__wrapper) {
  min-height: 36px;
  border-radius: 8px;

  box-shadow: 0 0 0 1px var(--el-border-color) inset;

  transition: box-shadow 0.2s ease;
}

.filter-card :deep(.el-input__wrapper:hover),
.filter-card :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--el-color-primary-light-5) inset;
}

/* 表格 */

.table-card {
  box-sizing: border-box;
  padding: 8px 18px 14px;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;
}

.table-card :deep(.el-table) {
  --el-table-border-color: var(--el-border-color-lighter);

  --el-table-header-bg-color: transparent;

  --el-table-row-hover-bg-color: var(--el-fill-color-lighter);

  background: transparent;
}

.table-card :deep(.el-table::before) {
  display: none;
}

.table-card :deep(.el-table th.el-table__cell) {
  height: 46px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 600;
  background: transparent;
}

.table-card :deep(.el-table td.el-table__cell) {
  height: 52px;
  color: var(--el-text-color-regular);
}

.table-card :deep(.el-table .cell) {
  line-height: 20px;
}

.table-card :deep(.el-tag) {
  font-weight: 500;
  border-radius: 6px;
}

.table-card :deep(.el-button.is-link) {
  padding: 4px 1px;
  font-weight: 500;
}

.table-card :deep(.el-button + .el-button) {
  margin-left: 6px;
}

/* 错误 / 分页 */

.error-state {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 10px 0;
}

.error-state .el-button {
  align-self: flex-start;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: 14px;
}

.pagination :deep(.el-pager li),
.pagination :deep(.btn-prev),
.pagination :deep(.btn-next) {
  border-radius: 7px;
}

@media (max-width: 1024px) {
  .search-input {
    flex: 1 1 260px;
  }
}

@media (max-width: 768px) {
  .filter-card {
    flex-direction: column;
  }

  .search-input,
  .filter-select,
  .date-picker {
    width: 100%;
  }

  .table-card {
    padding: 8px 12px 12px;
  }
}
</style>
