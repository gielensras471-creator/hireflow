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
      <el-table :data="pagedInterviews" row-key="id" empty-text="暂无面试安排">
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
              <el-button link type="primary" @click="handleEdit(row)"> 编辑 </el-button>

              <el-button link type="success" @click="handleComplete(row)"> 完成 </el-button>

              <el-button link type="warning" @click="handleCancel(row)"> 取消 </el-button>
            </template>

            <el-button link type="primary" @click="handleViewCandidate(row)"> 候选人 </el-button>

            <el-button link type="danger" @click="handleDelete(row)"> 删除 </el-button>
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
    </div>
    <InterviewDialog
      v-model="editDialogVisible"
      :interview="editingInterview"
      @submit="handleSubmitEdit"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { ElMessage, ElMessageBox } from 'element-plus'

import { useInterviewStore } from '@/store/modules/interview'

import { useCandidateStore } from '@/store/modules/candidate'

import InterviewDialog from '@/views/candidates/components/InterviewDialog.vue'

import type { Interview, InterviewFormData, InterviewStatus } from '@/types/interview'

const editDialogVisible = ref(false)

const editingInterview = ref<Interview | null>(null)
const handleEdit = (interview: Interview) => {
  editingInterview.value = interview

  editDialogVisible.value = true
}
const handleSubmitEdit = (data: InterviewFormData) => {
  if (!editingInterview.value) {
    return
  }

  const success = interviewStore.updateInterview(editingInterview.value.id, data)

  if (!success) {
    ElMessage.error('未找到面试记录')

    return
  }

  ElMessage.success('面试安排修改成功')
}
const router = useRouter()

const interviewStore = useInterviewStore()

const candidateStore = useCandidateStore()

const { interviews } = storeToRefs(interviewStore)

/* =========================
   搜索 / 筛选 / 分页
========================= */

const keyword = ref('')

const statusFilter = ref<InterviewStatus | ''>('scheduled')

const dateFilter = ref('')

const currentPage = ref(1)

const pageSize = ref(5)

const filteredInterviews = computed(() => {
  return interviews.value.filter((item) => {
    const matchKeyword = item.candidateName.toLowerCase().includes(keyword.value.toLowerCase())

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

    interviewStore.updateInterviewStatus(interview.id, 'completed')

    const candidate = candidateStore.getCandidateById(interview.candidateId)

    /*
      简单招聘流程联动：

      初面完成
      → 进入复面

      复面完成
      → 进入 Offer
    */
    if (candidate) {
      if (interview.type === '初面' && candidate.stage === 'first_interview') {
        candidate.stage = 'second_interview'
      }

      if (interview.type === '复面' && candidate.stage === 'second_interview') {
        candidate.stage = 'offer'
      }
    }

    ElMessage.success('面试已完成，候选人流程已同步更新')
  } catch {
    // 用户取消
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

    interviewStore.updateInterviewStatus(interview.id, 'cancelled')

    ElMessage.success('面试已取消')
  } catch {
    // 用户取消
  }
}

/* =========================
   删除面试记录
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

    interviewStore.removeInterview(interview.id)

    if (pagedInterviews.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }

    ElMessage.success('面试记录已删除')
  } catch {
    // 用户取消
  }
}
</script>

<style scoped lang="scss">
.interview-page {
  width: 100%;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.filter-card,
.table-card {
  padding: 20px;
  margin-bottom: 16px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
}

.filter-card {
  display: flex;
  gap: 12px;
}

.search-input {
  width: 260px;
}

.filter-select {
  width: 160px;
}

.date-picker {
  width: 180px;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

@media (max-width: 900px) {
  .filter-card {
    flex-direction: column;
  }

  .search-input,
  .filter-select,
  .date-picker {
    width: 100%;
  }
}
</style>
