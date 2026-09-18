<template>
  <div class="hf-tabs" aria-label="已打开页面">
    <div class="hf-tabs__track">
      <button
        v-for="tab in tabsStore.tabs"
        :key="tab.path"
        class="hf-tab"
        :class="{ 'is-active': tab.path === route.fullPath }"
        type="button"
        @click="router.push(tab.path)"
      >
        <span>{{ tab.title }}</span>
        <span
          v-if="tab.closable"
          class="hf-tab__close"
          role="button"
          tabindex="0"
          aria-label="关闭标签"
          @click.stop="closeTab(tab.path)"
          @keydown.enter.stop="closeTab(tab.path)"
        >×</span>
      </button>
    </div>

    <button v-if="tabsStore.tabs.length > 2" class="hf-tabs__action" type="button" @click="closeOthers">
      关闭其他
    </button>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()

const syncCurrentRoute = () => {
  if (route.meta.public) return

  tabsStore.addTab({
    title: typeof route.meta.title === 'string' ? route.meta.title : String(route.name ?? '页面'),
    path: route.fullPath,
    closable: route.path !== '/dashboard'
  })
}

watch(() => route.fullPath, syncCurrentRoute, { immediate: true })

const closeTab = async (path: string) => {
  const nextTab = tabsStore.removeTab(path)

  if (path === route.fullPath && nextTab) {
    await router.push(nextTab.path)
  }
}

const closeOthers = () => {
  tabsStore.closeOthers(route.fullPath)
}
</script>
