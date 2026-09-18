<template>
  <div class="hf-shell" :class="{ 'hf-shell--collapsed': uiStore.sidebarCollapsed }">
    <AppSidebar :collapsed="uiStore.sidebarCollapsed" />

    <div class="hf-shell__workspace">
      <AppHeader :collapsed="uiStore.sidebarCollapsed" @toggle-sidebar="uiStore.toggleSidebar" />
      <AppTabs />

      <main class="hf-content">
        <RouterView v-slot="{ Component }">
          <Transition name="hf-page" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
import AppTabs from './AppTabs.vue'
import { useUiStore } from '@/stores/ui'
import { useProfileStore } from '@/stores/profile'

const uiStore = useUiStore()
const profileStore = useProfileStore()

const syncSidebarWithViewport = () => {
  if (window.innerWidth < 1180) {
    uiStore.setSidebarCollapsed(true)
  }
}

onMounted(() => {
  syncSidebarWithViewport()
  profileStore.fetchProfile().catch((error) => {
    console.error('用户资料加载失败：', error)
  })
  window.addEventListener('resize', syncSidebarWithViewport)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncSidebarWithViewport)
})
</script>
