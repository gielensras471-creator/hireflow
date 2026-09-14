<template>
  <div class="tabs-box">
    <div class="tabs-menu">
      <el-tabs v-model="tabsMenuValue" type="card" @tab-click="clickTab" @tab-remove="removeTab">
        <el-tab-pane
          v-for="item in tabsMenuList"
          :key="item.path"
          :label="item.title"
          :name="item.path"
          :closable="item.close"
        />
      </el-tabs>

      <MoreButton />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'

import type { TabPaneName, TabsPaneContext } from 'element-plus'

import { useTabsStore } from '@/store/modules/tabs'

import MoreButton from './components/MoreButton.vue'

const route = useRoute()

const router = useRouter()

const tabsStore = useTabsStore()

const tabsMenuValue = ref(route.fullPath)

const tabsMenuList = computed(() => tabsStore.tabsMenuList)

/*
 * 路由变化时：
 * 1. 同步当前激活 Tab
 * 2. 如果当前页面尚未存在，则加入 Tabs
 */
watch(
  () => route.fullPath,
  () => {
    tabsMenuValue.value = route.fullPath

    const tabsParams = {
      icon: route.meta.icon as string,

      title: (route.meta.title as string) || String(route.name || '页面'),

      path: route.fullPath,

      name: route.name as string,

      close: route.meta.isAffix !== true,

      isKeepAlive: Boolean(route.meta.isKeepAlive)
    }

    tabsStore.addTab(tabsParams)
  },
  {
    immediate: true
  }
)

const clickTab = (tabItem: TabsPaneContext) => {
  const fullPath = tabItem.props.name as string

  router.push(fullPath)
}

const removeTab = (fullPath: TabPaneName) => {
  tabsStore.removeTab(fullPath as string, fullPath === route.fullPath)
}
</script>

<style scoped lang="scss">
@import './index';
</style>
