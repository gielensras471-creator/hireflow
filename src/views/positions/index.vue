<template>
  <div class="position-page">
    <div class="page-header">
      <div>
        <h2>职位管理</h2>
        <p>管理招聘职位及招聘进度</p>
      </div>

      <el-button type="primary" @click="openCreateDialog"> + 新建职位 </el-button>
    </div>

    <div class="filter-card">
      <el-input v-model="keyword" placeholder="搜索职位名称" clearable class="search-input" />

      <el-select v-model="statusFilter" placeholder="职位状态" clearable class="status-select">
        <el-option label="招聘中" value="open" />
        <el-option label="已关闭" value="closed" />
      </el-select>
    </div>

    <div class="table-card">
      <el-table :data="pagedPositions">
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

        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)"> 编辑 </el-button>

            <el-button link type="warning" @click="handleToggleStatus(row)">
              {{ row.status === 'open' ? '关闭' : '重新开启' }}
            </el-button>

            <el-button link type="danger" @click="handleDeletePosition(row)"> 删除 </el-button>
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
    </div>
    <PositionDialog
      v-model="dialogVisible"
      :position="editingPosition"
      @submit="handleSubmitPosition"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import type { Position, PositionFormData, PositionStatus } from '@/types/position'

import PositionDialog from './components/PositionDialog.vue'

const dialogVisible = ref(false)
const editingPosition = ref<Position | null>(null)

const openCreateDialog = () => {
  editingPosition.value = null
  dialogVisible.value = true
}

const openEditDialog = (position: Position) => {
  editingPosition.value = position
  dialogVisible.value = true
}
const keyword = ref('')
const statusFilter = ref<PositionStatus | ''>('')

const currentPage = ref(1)
const pageSize = ref(5)
watch([keyword, statusFilter], () => {
  currentPage.value = 1
})

const positions = ref<Position[]>([
  {
    id: 1,
    title: '前端开发工程师',
    department: '技术部',
    location: '深圳',
    status: 'open',
    candidateCount: 18,
    publishDate: '2026-09-10',
    description: '负责公司 Web 前端业务开发'
  },
  {
    id: 2,
    title: 'Java 后端工程师',
    department: '技术部',
    location: '深圳',
    status: 'open',
    candidateCount: 25,
    publishDate: '2026-09-08',
    description: '负责服务端业务系统开发'
  },
  {
    id: 3,
    title: 'UI 设计师',
    department: '设计部',
    location: '深圳',
    status: 'closed',
    candidateCount: 9,
    publishDate: '2026-08-26',
    description: '负责产品界面和视觉设计'
  },
  {
    id: 4,
    title: '产品助理',
    department: '产品部',
    location: '深圳',
    status: 'open',
    candidateCount: 14,
    publishDate: '2026-09-05',
    description: '协助产品需求分析和项目推进'
  },
  {
    id: 5,
    title: '测试工程师',
    department: '技术部',
    location: '广州',
    status: 'open',
    candidateCount: 11,
    publishDate: '2026-09-03',
    description: '负责 Web 产品测试和质量保障'
  },
  {
    id: 6,
    title: '运营专员',
    department: '运营部',
    location: '深圳',
    status: 'closed',
    candidateCount: 7,
    publishDate: '2026-08-20',
    description: '负责平台运营和活动执行'
  }
])

const filteredPositions = computed(() => {
  return positions.value.filter((item) => {
    const matchKeyword = item.title.toLowerCase().includes(keyword.value.toLowerCase())

    const matchStatus = !statusFilter.value || item.status === statusFilter.value

    return matchKeyword && matchStatus
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

const handleSubmitPosition = (data: PositionFormData) => {
  if (editingPosition.value) {
    const target = positions.value.find((item) => item.id === editingPosition.value?.id)

    if (target) {
      Object.assign(target, data)
    }

    ElMessage.success('职位修改成功')
    return
  }

  const newPosition: Position = {
    id: Date.now(),
    ...data,
    candidateCount: 0,
    publishDate: getCurrentDate()
  }

  positions.value.unshift(newPosition)
  currentPage.value = 1

  ElMessage.success('职位创建成功')
}
const handleToggleStatus = async (position: Position) => {
  const isOpen = position.status === 'open'

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

    position.status = isOpen ? 'closed' : 'open'

    ElMessage.success(`职位已${actionText}`)
  } catch {
    // 用户点击取消，不执行任何操作
  }
}
const handleDeletePosition = async (position: Position) => {
  try {
    await ElMessageBox.confirm(`删除后无法恢复，确定删除职位“${position.title}”吗？`, '删除职位', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })

    positions.value = positions.value.filter((item) => item.id !== position.id)

    if (pagedPositions.value.length === 0 && currentPage.value > 1) {
      currentPage.value--
    }

    ElMessage.success('职位删除成功')
  } catch {
    // 用户点击取消
  }
}
</script>

<style scoped lang="scss">
.position-page {
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
  width: 280px;
}

.status-select {
  width: 160px;
}

.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

@media (max-width: 768px) {
  .filter-card {
    flex-direction: column;
  }

  .search-input,
  .status-select {
    width: 100%;
  }
}
</style>
