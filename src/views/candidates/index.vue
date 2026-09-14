<template>
  <div class="candidate-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div>
        <h2>候选人管理</h2>
        <p>管理候选人信息与招聘流程</p>
      </div>

      <el-button type="primary" :disabled="loading" @click="openCreateDialog">
        + 新增候选人
      </el-button>
    </div>

    <!-- 搜索与筛选 -->
    <div class="filter-card">
      <el-input v-model="keyword" placeholder="搜索候选人姓名" clearable class="search-input" />

      <el-select v-model="positionFilter" placeholder="应聘职位" clearable class="filter-select">
        <el-option
          v-for="position in positionOptions"
          :key="position"
          :label="position"
          :value="position"
        />
      </el-select>

      <el-select v-model="stageFilter" placeholder="招聘阶段" clearable class="filter-select">
        <el-option label="筛选中" value="screening" />

        <el-option label="初面" value="first_interview" />

        <el-option label="复面" value="second_interview" />

        <el-option label="Offer" value="offer" />

        <el-option label="已淘汰" value="rejected" />
      </el-select>
    </div>

    <!-- 候选人表格 -->
    <div class="table-card">
      <!-- 请求失败 -->
      <div v-if="error" class="error-state">
        <el-alert
          title="候选人数据加载失败"
          description="请确认 Mock API 是否正常运行。"
          type="error"
          show-icon
          :closable="false"
        />

        <el-button type="primary" :loading="loading" @click="loadCandidates"> 重新加载 </el-button>
      </div>

      <!-- 请求正常 -->
      <template v-else>
        <el-table
          v-loading="loading"
          :data="pagedCandidates"
          row-key="id"
          empty-text="暂无符合条件的候选人"
        >
          <el-table-column prop="name" label="姓名" min-width="100" />

          <el-table-column prop="position" label="应聘职位" min-width="170" />

          <el-table-column prop="education" label="学历" width="90" />

          <el-table-column prop="school" label="毕业院校" min-width="140" />

          <el-table-column label="招聘阶段" width="110">
            <template #default="{ row }">
              <el-tag :type="getStageTagType(row.stage)">
                {{ getStageLabel(row.stage) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="appliedDate" label="投递日期" width="120" />

          <el-table-column prop="owner" label="负责人" width="100" />

          <!-- 操作列 -->
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :disabled="deletingId === row.id"
                @click="handleView(row)"
              >
                查看
              </el-button>

              <el-button
                link
                type="primary"
                :disabled="deletingId === row.id"
                @click="handleEdit(row)"
              >
                编辑
              </el-button>

              <el-button
                link
                type="success"
                :disabled="deletingId === row.id"
                @click="handleInterview(row)"
              >
                安排面试
              </el-button>

              <el-button
                link
                type="danger"
                :loading="deletingId === row.id"
                @click="handleDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页 -->
        <div class="pagination">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            layout="total, prev, pager, next"
            :total="filteredCandidates.length"
          />
        </div>
      </template>
    </div>

    <!-- 新增 / 编辑候选人 -->
    <CandidateDialog
      v-model="dialogVisible"
      :candidate="editingCandidate"
      :submitting="submitting"
      @submit="handleSubmitCandidate"
    />

    <!-- 安排面试 -->
    <InterviewDialog
      v-model="interviewDialogVisible"
      :candidate="interviewCandidate"
      @submit="handleSubmitInterview"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'

import { ElMessage, ElMessageBox } from 'element-plus'

import type { Candidate, CandidateFormData, CandidateStage } from '@/types/candidate'

import type { InterviewFormData } from '@/types/interview'

import { useCandidateStore } from '@/store/modules/candidate'

import { useInterviewStore } from '@/store/modules/interview'

import CandidateDialog from './components/CandidateDialog.vue'
import InterviewDialog from './components/InterviewDialog.vue'

const router = useRouter()

const candidateStore = useCandidateStore()

const interviewStore = useInterviewStore()

const { candidates, loading, error } = storeToRefs(candidateStore)

/* =========================
   页面请求状态
========================= */

const submitting = ref(false)

const deletingId = ref<number | null>(null)

/* =========================
   加载候选人
========================= */

const loadCandidates = async () => {
  try {
    await candidateStore.fetchCandidates(true)
  } catch (error) {
    console.error('候选人加载失败：', error)
  }
}

onMounted(() => {
  loadCandidates()
})

/* =========================
   新增 / 编辑候选人
========================= */

const dialogVisible = ref(false)

const editingCandidate = ref<Candidate | null>(null)

const openCreateDialog = () => {
  editingCandidate.value = null
  dialogVisible.value = true
}

const handleEdit = (candidate: Candidate) => {
  editingCandidate.value = {
    ...candidate
  }

  dialogVisible.value = true
}

/* =========================
   安排面试
========================= */

const interviewDialogVisible = ref(false)

const interviewCandidate = ref<Candidate | null>(null)

const handleInterview = (candidate: Candidate) => {
  interviewCandidate.value = candidate

  interviewDialogVisible.value = true
}

const handleSubmitInterview = async (data: InterviewFormData) => {
  const success = interviewStore.addInterview(data)

  if (!success) {
    ElMessage.warning('该候选人已经存在待面试安排')

    return
  }

  try {
    /*
     * 候选人仍处于筛选阶段时，
     * 安排第一次面试后自动进入初面。
     */
    if (interviewCandidate.value && interviewCandidate.value.stage === 'screening') {
      await candidateStore.updateCandidateStage(interviewCandidate.value.id, 'first_interview')
    }

    ElMessage.success('面试安排成功')
  } catch (error) {
    console.error('候选人阶段同步失败：', error)

    ElMessage.warning('面试已安排，但候选人阶段同步失败')
  }
}

/* =========================
   搜索 / 筛选 / 分页
========================= */

const keyword = ref('')

const positionFilter = ref('')

const stageFilter = ref<CandidateStage | ''>('')

const currentPage = ref(1)

const pageSize = ref(5)

const positionOptions = computed(() => {
  return [...new Set(candidates.value.map((item) => item.position))]
})

const filteredCandidates = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()

  return candidates.value.filter((item) => {
    const matchKeyword = item.name.toLowerCase().includes(normalizedKeyword)

    const matchPosition = !positionFilter.value || item.position === positionFilter.value

    const matchStage = !stageFilter.value || item.stage === stageFilter.value

    return matchKeyword && matchPosition && matchStage
  })
})

const pagedCandidates = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value

  const end = start + pageSize.value

  return filteredCandidates.value.slice(start, end)
})

watch([keyword, positionFilter, stageFilter], () => {
  currentPage.value = 1
})

/* =========================
   招聘阶段显示
========================= */

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

/* =========================
   查看候选人详情
========================= */

const handleView = (candidate: Candidate) => {
  router.push(`/candidates/${candidate.id}`)
}

/* =========================
   当前日期
========================= */

const getCurrentDate = () => {
  const date = new Date()

  const year = date.getFullYear()

  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/* =========================
   新增 / 编辑保存
========================= */

const handleSubmitCandidate = async (data: CandidateFormData) => {
  if (submitting.value) {
    return
  }

  submitting.value = true

  try {
    /*
     * 编辑候选人
     */
    if (editingCandidate.value) {
      await candidateStore.updateCandidate(editingCandidate.value.id, data)

      dialogVisible.value = false

      ElMessage.success('候选人信息修改成功')

      return
    }

    /*
     * 新增候选人
     */
    await candidateStore.addCandidate(data, getCurrentDate())

    currentPage.value = 1

    dialogVisible.value = false

    ElMessage.success('候选人新增成功')
  } catch (error) {
    console.error('候选人保存失败：', error)

    ElMessage.error(
      editingCandidate.value ? '候选人修改失败，请稍后重试' : '候选人新增失败，请稍后重试'
    )
  } finally {
    submitting.value = false
  }
}

/* =========================
   删除候选人
========================= */

const handleDelete = async (candidate: Candidate) => {
  /*
   * 先进行删除确认。
   * 用户取消不应该被当成接口错误。
   */
  try {
    await ElMessageBox.confirm(
      `删除后无法恢复，确定删除候选人“${candidate.name}”吗？`,
      '删除候选人',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  deletingId.value = candidate.id

  try {
    await candidateStore.removeCandidate(candidate.id)

    /*
     * 当前页最后一条数据被删除时，
     * 自动回到上一页。
     */
    if (pagedCandidates.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }

    ElMessage.success('候选人删除成功')
  } catch (error) {
    console.error('候选人删除失败：', error)

    ElMessage.error('候选人删除失败，请稍后重试')
  } finally {
    deletingId.value = null
  }
}
</script>

<style scoped lang="scss">
.candidate-page {
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
  width: 180px;
}

.error-state {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.error-state .el-button {
  align-self: flex-start;
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
  .filter-select {
    width: 100%;
  }
}
</style>
