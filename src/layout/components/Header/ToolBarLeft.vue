<template>
  <div class="tool-bar-lf">
    <CollapseIcon />

    <BreadCrumb v-show="globalStore.breadcrumb" />
  </div>
</template>

<script setup lang="ts">
import CollapseIcon from './components/CollapseIcon.vue'
import BreadCrumb from './components/BreadCrumb.vue'

import { useGlobalStore } from '@/store/modules/global'

const globalStore = useGlobalStore()
</script>

<style scoped lang="scss">
.tool-bar-lf {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 14px;

  :deep(.collapse-icon) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    margin-right: 0;
    color: var(--el-text-color-regular);
    border-radius: 9px;
    transition:
      background 0.2s ease,
      color 0.2s ease;

    &:hover {
      color: var(--el-color-primary);
      background: var(--el-fill-color-light);
    }
  }

  :deep(.el-breadcrumb__inner) {
    color: var(--el-text-color-secondary);
    font-size: 13px;
    font-weight: 400;
  }

  :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
    color: var(--el-text-color-primary);
    font-weight: 600;
  }

  :deep(.el-breadcrumb__separator) {
    color: var(--el-text-color-placeholder);
  }
}
</style>
