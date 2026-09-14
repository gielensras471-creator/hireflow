<template>
  <el-dropdown trigger="click" class="more-btn">
    <div class="down-box flx-center" title="标签页操作">
      <i class="iconfont icon-down"></i>
    </div>

    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item @click="closeCurrentTab">
          <span class="flx-center">
            <i class="iconfont icon-minus-circle"></i>
            关闭当前
          </span>
        </el-dropdown-item>

        <el-dropdown-item @click="tabsStore.closeTabsOnSide(route.fullPath, 'left')">
          <span class="flx-center">
            <i class="iconfont icon-d-arrow-left"></i>
            关闭左侧
          </span>
        </el-dropdown-item>

        <el-dropdown-item @click="tabsStore.closeTabsOnSide(route.fullPath, 'right')">
          <span class="flx-center">
            <i class="iconfont icon-d-arrow-right"></i>
            关闭右侧
          </span>
        </el-dropdown-item>

        <el-dropdown-item @click="tabsStore.closeMultipleTab(route.fullPath)">
          <span class="flx-center">
            <i class="iconfont icon-close-circle"></i>
            关闭其他
          </span>
        </el-dropdown-item>

        <el-dropdown-item @click="closeAllTab">
          <span class="flx-center">
            <i class="iconfont icon-fold-closed"></i>
            关闭全部
          </span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { HOME_URL } from '@/config'

import { useTabsStore } from '@/store/modules/tabs'

import { useRoute, useRouter } from 'vue-router'

const route = useRoute()

const router = useRouter()

const tabsStore = useTabsStore()

const closeCurrentTab = () => {
  if (route.meta.isAffix) {
    return
  }

  tabsStore.removeTab(route.fullPath)
}

const closeAllTab = () => {
  tabsStore.closeMultipleTab()

  router.push(HOME_URL)
}
</script>

<style scoped lang="scss">
.down-box {
  width: 36px;
  height: 32px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  transition:
    color 0.2s ease,
    background 0.2s ease;

  &:hover {
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }
}
</style>
