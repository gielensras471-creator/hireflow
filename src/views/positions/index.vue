<template>
  <div class="position-page">
    <div class="page-header">
      <div>
        <h2>职位管理</h2>
        <p>管理招聘职位及招聘进度</p>
      </div>

      <el-button type="primary" :disabled="loading" @click="openCreateDialog">
        + 新建职位
      </el-button>
    </div>

    <div class="filter-card">
      <el-input v-model="keyword" placeholder="搜索职位名称" clearable class="search-input" />

      <el-select
        v-model="departmentFilter"
        placeholder="所属部门"
        clearable
        class="department-select"
      >
        <el-option
          v-for="department in departmentOptions"
          :key="department"
          :label="department"
          :value="department"
        />
      </el-select>

      <el-select v-model="statusFilter" placeholder="职位状态" clearable class="status-select">
        <el-option label="招聘中" value="open" />

        <el-option label="已关闭" value="closed" />
      </el-select>
    </div>

    <div class="table-card">
      <div v-if="loadError" class="error-state">
        <el-alert
          title="职位数据加载失败"
          description="请确认 Express API 是否已经启动，然后重新加载。"
          type="error"
          show-icon
          :closable="false"
        />

        <el-button type="primary" :loading="loading" @click="loadPositions"> 重新加载 </el-button>
      </div>

      <template v-else>
        <el-table
          v-loading="loading"
          :data="pagedPositions"
          row-key="id"
          empty-text="暂无符合条件的职位"
        >
          <el-table-column prop="title" label="职位名称" min-width="180" />

          <el-table-column prop="department" label="部门" width="120" />

          <el-table-column prop="location" label="工作地点" width="120" />

          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="row.status === 'open' ? 'success' : 'info'">
                {{ row.status === 'open' ? '招聘中' : '已关闭' }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column prop="candidateCount" label="候选人数" width="110" />

          <el-table-column prop="publishDate" label="发布日期" width="130" />

          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :disabled="togglingId === row.id || deletingId === row.id"
                @click="openEditDialog(row)"
              >
                编辑
              </el-button>

              <el-button
                link
                type="warning"
                :loading="togglingId === row.id"
                :disabled="deletingId === row.id"
                @click="handleToggleStatus(row)"
              >
                {{ row.status === 'open' ? '关闭' : '重新开启' }}
              </el-button>

              <el-button
                link
                type="danger"
                :loading="deletingId === row.id"
                :disabled="togglingId === row.id"
                @click="handleDeletePosition(row)"
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
            :total="filteredPositions.length"
          />
        </div>
      </template>
    </div>

    <PositionDialog
      v-model="dialogVisible"
      :position="editingPosition"
      :submitting="submitting"
      @submit="handleSubmitPosition"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { ElMessage, ElMessageBox } from 'element-plus'

import {
  createPositionApi,
  deletePositionApi,
  getPositionListApi,
  updatePositionApi
} from '@/api/modules/position'

import type { Position, PositionFormData, PositionStatus } from '@/types/position'

import PositionDialog from './components/PositionDialog.vue'

const positions = ref<Position[]>([])

const loading = ref(false)

const loadError = ref(false)

const submitting = ref(false)

const togglingId = ref<number | null>(null)

const deletingId = ref<number | null>(null)

const dialogVisible = ref(false)

const editingPosition = ref<Position | null>(null)

const keyword = ref('')

const departmentFilter = ref('')

const statusFilter = ref<PositionStatus | ''>('')

const currentPage = ref(1)

const pageSize = ref(5)

const departmentOptions = computed(() => {
  return Array.from(new Set(positions.value.map((item) => item.department)))
})

watch([keyword, departmentFilter, statusFilter], () => {
  currentPage.value = 1
})

const filteredPositions = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()

  return positions.value.filter((item) => {
    const matchKeyword = item.title.toLowerCase().includes(normalizedKeyword)

    const matchDepartment = !departmentFilter.value || item.department === departmentFilter.value

    const matchStatus = !statusFilter.value || item.status === statusFilter.value

    return matchKeyword && matchDepartment && matchStatus
  })
})

const pagedPositions = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value

  const end = start + pageSize.value

  return filteredPositions.value.slice(start, end)
})

const getCurrentDate = () => {
  const date = new Date()

  const year = date.getFullYear()

  const month = String(date.getMonth() + 1).padStart(2, '0')

  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const sortPositions = (list: Position[]) => {
  return [...list].sort((a, b) => {
    const dateResult = b.publishDate.localeCompare(a.publishDate)

    if (dateResult !== 0) {
      return dateResult
    }

    return b.id - a.id
  })
}

const loadPositions = async () => {
  loading.value = true
  loadError.value = false

  try {
    const data = await getPositionListApi()

    positions.value = sortPositions(data)
  } catch (error) {
    console.error('职位列表加载失败：', error)

    loadError.value = true
  } finally {
    loading.value = false
  }
}

const openCreateDialog = () => {
  editingPosition.value = null
  dialogVisible.value = true
}

const openEditDialog = (position: Position) => {
  editingPosition.value = {
    ...position
  }

  dialogVisible.value = true
}

const handleSubmitPosition = async (data: PositionFormData) => {
  if (submitting.value) {
    return
  }

  submitting.value = true

  try {
    if (editingPosition.value) {
      const updated = await updatePositionApi(editingPosition.value.id, data)

      const index = positions.value.findIndex((item) => item.id === updated.id)

      if (index !== -1) {
        positions.value[index] = updated
      }

      editingPosition.value = updated

      dialogVisible.value = false

      ElMessage.success('职位修改成功')

      return
    }

    const created = await createPositionApi({
      ...data,
      candidateCount: 0,
      publishDate: getCurrentDate()
    })

    positions.value.unshift(created)

    currentPage.value = 1

    dialogVisible.value = false

    ElMessage.success('职位创建成功')
  } catch (error) {
    console.error('职位保存失败：', error)

    ElMessage.error(editingPosition.value ? '职位修改失败，请稍后重试' : '职位创建失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

const handleToggleStatus = async (position: Position) => {
  const isOpen = position.status === 'open'

  const nextStatus: PositionStatus = isOpen ? 'closed' : 'open'

  const actionText = isOpen ? '关闭' : '重新开启'

  try {
    await ElMessageBox.confirm(
      `确定要${actionText}职位“${position.title}”吗？`,
      `${actionText}职位`,
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
  } catch {
    return
  }

  togglingId.value = position.id

  try {
    const updated = await updatePositionApi(position.id, {
      status: nextStatus
    })

    Object.assign(position, updated)

    ElMessage.success(isOpen ? '职位已关闭' : '职位已重新开启')
  } catch (error) {
    console.error('职位状态更新失败：', error)

    ElMessage.error('职位状态更新失败，请稍后重试')
  } finally {
    togglingId.value = null
  }
}

const handleDeletePosition = async (position: Position) => {
  try {
    await ElMessageBox.confirm(`删除后无法恢复，确定删除职位“${position.title}”吗？`, '删除职位', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  deletingId.value = position.id

  try {
    await deletePositionApi(position.id)

    positions.value = positions.value.filter((item) => item.id !== position.id)

    if (pagedPositions.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }

    ElMessage.success('职位删除成功')
  } catch (error) {
    console.error('职位删除失败：', error)

    ElMessage.error('职位删除失败，请稍后重试')
  } finally {
    deletingId.value = null
  }
}

onMounted(() => {
  loadPositions()
})
</script>

<style scoped lang="scss">
.position-page {
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

/* =====================
   筛选区
===================== */

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

.department-select,
.status-select {
  width: 160px;
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

/* =====================
   表格卡片
===================== */

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
  padding: 4px 2px;
  font-weight: 500;
}

.table-card :deep(.el-button + .el-button) {
  margin-left: 8px;
}

/* =====================
   错误 / 分页
===================== */

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

@media (max-width: 900px) {
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
  .department-select,
  .status-select {
    width: 100%;
  }

  .table-card {
    padding: 8px 12px 12px;
  }
}
</style>
