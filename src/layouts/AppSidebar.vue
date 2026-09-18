<template>
  <aside class="hf-sidebar" :class="{ 'hf-sidebar--collapsed': collapsed }">
    <button class="hf-brand" type="button" aria-label="返回工作台" @click="router.push('/dashboard')">
      <span class="hf-brand__mark">HF</span>
      <span v-if="!collapsed" class="hf-brand__copy">
        <strong>HireFlow</strong>
        <small>招聘流程协作平台</small>
      </span>
    </button>

    <nav class="hf-nav" aria-label="主导航">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="hf-nav__item"
        :class="{ 'is-active': activePath === item.path }"
        :title="collapsed ? item.label : undefined"
      >
        <span class="hf-nav__icon" v-html="item.icon" />
        <span v-if="!collapsed" class="hf-nav__label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="hf-sidebar__footer">
      <span v-if="!collapsed">HireFlow V2</span>
      <span v-else>V2</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

defineProps<{
  collapsed: boolean
}>()

const route = useRoute()
const router = useRouter()

const icon = (path: string) => `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
</svg>`

const navItems = [
  {
    path: '/dashboard',
    label: '工作台',
    icon: icon('M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z')
  },
  {
    path: '/positions',
    label: '职位管理',
    icon: icon('M9 6V4h6v2m-9 3h12a2 2 0 0 1 2 2v7H4v-7a2 2 0 0 1 2-2Zm-2 5h16M9 12h6')
  },
  {
    path: '/candidates',
    label: '候选人管理',
    icon: icon('M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m6.5-10A3.5 3.5 0 1 0 9.5 3a3.5 3.5 0 0 0 0 7Zm7.5 1a3 3 0 0 1 0-6m4 15v-2a4 4 0 0 0-3-3.87')
  },
  {
    path: '/interviews',
    label: '面试管理',
    icon: icon('M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 8h3v3H8v-3Z')
  },
  {
    path: '/profile',
    label: '个人中心',
    icon: icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0')
  }
]

const activePath = computed(() => {
  const metaPath = route.meta.activeMenu
  return typeof metaPath === 'string' ? metaPath : route.path
})

</script>
