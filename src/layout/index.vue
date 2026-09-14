<template>
  <el-container class="layout">
    <el-aside>
      <div
        class="aside"
        :class="{
          'is-collapsed': isCollapse
        }"
        :style="{
          width: isCollapse ? '72px' : '228px'
        }"
      >
        <button class="brand" type="button" @click="goDashboard">
          <span class="brand-mark"> HF </span>

          <span v-show="!isCollapse" class="brand-copy">
            <strong> HireFlow </strong>

            <small> 招聘流程协作平台 </small>
          </span>
        </button>

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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useGlobalStore } from '@/store/modules/global'

import type { AppMenuItem } from '@/types/navigation'

import SubMenu from './components/Menu/SubMenu.vue'
import ToolBarLeft from './components/Header/ToolBarLeft.vue'
import ToolBarRight from './components/Header/ToolBarRight.vue'
import Main from './components/Main/index.vue'

const route = useRoute()
const router = useRouter()

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

const activeMenu = computed(() => (route.meta.activeMenu as string) || route.path)

const goDashboard = () => {
  router.push('/dashboard')
}
</script>

<style scoped lang="scss">
@import './index';
</style>
