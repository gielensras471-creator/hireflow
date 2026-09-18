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
          description="请确认 Express API 是否正常运行。"
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
              <el-tag :type="getCandidateStageTagType(row.stage)">
                {{ getCandidateStageLabel(row.stage) }}
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
                :disabled="deletingId === row.id || !canArrangeInterview(row.stage)"
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
      :submitting="submitting"
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

import {
  canArrangeInterview,
  getCandidateStageLabel,
  getCandidateStageTagType,
  getStageAfterInterviewScheduled
} from '@/config/recruitment'

import type { InterviewFormData } from '@/types/interview'

import { useCandidateStore } from '@/stores/candidate'

import { useInterviewStore } from '@/stores/interview'

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
  if (!canArrangeInterview(candidate.stage)) {
    ElMessage.warning('当前招聘阶段不能继续安排面试')

    return
  }

  interviewCandidate.value = candidate

  interviewDialogVisible.value = true
}

const handleSubmitInterview = async (data: InterviewFormData) => {
  if (submitting.value) {
    return
  }

  submitting.value = true

  try {
    const created = await interviewStore.addInterview(data)

    if (!created) {
      ElMessage.warning('该候选人已经存在待面试安排')

      return
    }

    if (interviewCandidate.value) {
      const nextStage = getStageAfterInterviewScheduled(interviewCandidate.value.stage)

      if (nextStage) {
        await candidateStore.updateCandidateStage(interviewCandidate.value.id, nextStage)
      }
    }
    interviewDialogVisible.value = false

    ElMessage.success('面试安排成功')
  } catch (error) {
    console.error('安排面试失败：', error)

    ElMessage.error('面试安排失败，请稍后重试')
  } finally {
    submitting.value = false
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

.page-header :deep(.el-button) {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
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
  margin-left: 7px;
}

/* 错误和分页 */

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
  .page-header {
    align-items: flex-start;
  }

  .filter-card {
    flex-direction: column;
  }

  .search-input,
  .filter-select {
    width: 100%;
  }

  .table-card {
    padding: 8px 12px 12px;
  }
}
</style>
