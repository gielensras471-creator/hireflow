<template>
  <el-container class="layout">
    <el-aside>
      <div class="aside" :style="{ width: isCollapse ? '65px' : '210px' }">
        <div class="logo">
          <img class="logo-img" src="@/assets/images/logo.svg" alt="logo" />
          <span v-show="!isCollapse" class="logo-text">HireFlow</span>
        </div>
        <el-scrollbar>
          <el-menu
            :router="false"
            :default-active="activeMenu"
            :collapse="isCollapse"
            :unique-opened="true"
            :collapse-transition="false"
          >
            <SubMenu :menu-list="menuList" />
          </el-menu>
        </el-scrollbar>
      </div>
    </el-aside>
    <el-container>
      <el-header>
        <ToolBarLeft />
        <ToolBarRight />
      </el-header>
      <Main />
    </el-container>
  </el-container>
  <ThemeDrawer />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGlobalStore } from '@/store/modules/global'
import type { AppMenuItem } from '@/types/navigation'

import SubMenu from './components/Menu/SubMenu.vue'
import ToolBarLeft from './components/Header/ToolBarLeft.vue'
import ToolBarRight from './components/Header/ToolBarRight.vue'
import Main from './components/Main/index.vue'
import ThemeDrawer from './components/ThemeDrawer/index.vue'

const route = useRoute()
const globalStore = useGlobalStore()

const menuList: AppMenuItem[] = [
  {
    path: '/dashboard',
    meta: {
      title: '工作台'
    }
  },
  {
    path: '/positions',
    meta: {
      title: '职位管理'
    }
  },
  {
    path: '/candidates',
    meta: {
      title: '候选人管理'
    }
  },
  {
    path: '/interviews',
    meta: {
      title: '面试管理'
    }
  },
  {
    path: '/profile',
    meta: {
      title: '个人中心'
    }
  }
]

const isCollapse = computed(() => globalStore.isCollapse)

const activeMenu = computed(
  () => (route.meta.activeMenu as string) || route.path
)
</script>

<style scoped lang="scss">
@import './index';
</style>
