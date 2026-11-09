<template>
  <div ref="root" class="v3-ui v3-shell" :data-tier="tier.name">
    <template v-if="user">
      <aside
        v-if="tier.name !== 'mobile'"
        class="v3-sidebar"
        :class="{ 'is-collapsed': collapsed }"
      >
        <p class="v3-brand">{{ collapsed ? 'HF' : 'HireFlow' }}</p>
        <nav aria-label="业务导航">
          <RouterLink
            v-for="section in v3Sections"
            :key="section.path"
            :to="section.path"
            :aria-label="section.title"
            :title="section.title"
            :class="{ 'is-current': isSection(section.path) }"
          >
            <svg
              class="v3-nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path :d="icons[section.name]" />
            </svg>
            <span v-if="!collapsed">{{ section.title }}</span>
          </RouterLink>
        </nav>
      </aside>

      <div class="v3-workspace">
        <header class="v3-header">
          <div class="v3-header-start">
            <button
              ref="navToggle"
              type="button"
              class="v3-icon-button"
              :aria-label="navigationLabel"
              :aria-expanded="tier.name === 'mobile' ? drawerOpen : !collapsed"
              @click="toggleNav"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <span v-if="tier.name === 'mobile'" class="v3-brand">HireFlow</span>
          </div>
          <div class="v3-account">
            <RouterLink to="/profile" :title="user.name + ' · ' + user.role" aria-label="个人中心">
              {{ user.name }} <small>{{ user.role }}</small>
            </RouterLink>
            <el-button text @click="logout">退出</el-button>
          </div>
        </header>

        <div class="v3-tabs" aria-label="已打开页面" @keydown.esc="closeOverflow()">
          <div
            v-for="tab in visible"
            :key="tab.key"
            class="v3-tab"
            :class="{ 'is-active': tab.key === route.path }"
          >
            <RouterLink :to="tab.target" :title="tab.title">{{ tab.title }}</RouterLink>
            <button type="button" :aria-label="'关闭 ' + tab.title" @click="closeTab(tab)">
              ×
            </button>
          </div>
          <details v-if="overflow.length" ref="more" class="v3-more">
            <summary>更多页面 <span aria-hidden="true">▾</span></summary>
            <ul>
              <li v-for="tab in overflow" :key="tab.key">
                <RouterLink :to="tab.target" :title="tab.title" @click="closeOverflow(false)">{{
                  tab.title
                }}</RouterLink>
                <button type="button" :aria-label="'关闭 ' + tab.title" @click="closeTab(tab)">
                  ×
                </button>
              </li>
            </ul>
          </details>
        </div>

        <main class="v3-content">
          <V3Feedback
            v-if="status === 'unavailable'"
            state="error"
            title="连接暂时中断，未保存内容已保留"
            message="恢复连接后可继续编辑。"
            action="重试连接"
            @action="v3Session.refresh()"
          />
          <div :inert="status !== 'ready'"><RouterView /></div>
        </main>
      </div>

      <dialog
        ref="drawer"
        class="v3-drawer"
        aria-label="业务导航"
        @click.self="dismissDrawer"
        @close="onDrawerClosed"
      >
        <div class="v3-drawer-panel">
          <div class="v3-drawer-header">
            <p class="v3-brand">HireFlow</p>
            <button
              type="button"
              class="v3-icon-button"
              aria-label="关闭导航"
              @click="dismissDrawer"
            >
              ×
            </button>
          </div>
          <nav aria-label="业务导航">
            <RouterLink
              v-for="section in v3Sections"
              :key="section.path"
              :to="section.path"
              :class="{ 'is-current': isSection(section.path) }"
              @click="dismissDrawer"
            >
              <svg
                class="v3-nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path :d="icons[section.name]" /></svg
              >{{ section.title }}
            </RouterLink>
          </nav>
        </div>
      </dialog>
    </template>
    <main v-else class="v3-content">
      <V3Feedback
        v-if="status === 'unavailable'"
        state="error"
        title="暂时无法确认身份"
        message="请确认本地 V3 服务正在运行。"
        action="重试连接"
        @action="v3Session.refresh()"
      />
      <V3Feedback v-else state="loading" title="正在确认身份" />
      <el-button v-if="status === 'unavailable'" @click="v3Session.clear()">退出</el-button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v3Session } from '../api/request-v3'
import V3Feedback from '../components/V3Feedback.vue'
import { confirmV3Leave } from '../router/v3-drafts'
import {
  shellTier,
  tabInfo,
  visit,
  visibleTabs,
  v3Sections,
  type V3Tab
} from '../router/v3-navigation'
import { v3TabsKey } from '../utils/auth-v3'

const route = useRoute()
const router = useRouter()
const user = computed(() => v3Session.state.user)
const status = computed(() => v3Session.state.status)
const owner = computed(() => user.value && user.value.id + ':' + user.value.username)
const root = ref<HTMLElement>()
const navToggle = ref<HTMLButtonElement>()
const drawer = ref<HTMLDialogElement>()
const more = ref<HTMLDetailsElement>()
const drawerOpen = ref(false)
const width = ref(window.innerWidth)
const tier = computed(() => shellTier(width.value))
const collapsed = ref(tier.value.name !== 'desktop')
const navigationLabel = computed(() =>
  tier.value.name === 'mobile' ? '打开导航' : collapsed.value ? '展开导航' : '折叠导航'
)
const tabs = ref<V3Tab[]>([])
const { visible, overflow } = {
  visible: computed(() => visibleTabs(tabs.value, tier.value.limit).visible),
  overflow: computed(() => visibleTabs(tabs.value, tier.value.limit).overflow)
}
const icons = {
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  positions: 'M3 7h18v14H3z M8 7V4h8v3 M3 12h18 M10 12v2h4v-2',
  candidates:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8',
  interviews: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M12 14h2 M7 17h2'
}
let currentOwner: string | null = null

function restoreTabs() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(v3TabsKey) ?? 'null')
    if (saved?.owner === owner.value && Array.isArray(saved.paths)) {
      return saved.paths
        .filter((path: unknown): path is string => typeof path === 'string')
        .reduceRight((result: V3Tab[], path: string) => visit(result, path, path), [])
    }
  } catch {
    // Malformed tab state has no bearing on authentication or navigation.
  }
  return []
}

function saveTabs() {
  if (owner.value) {
    sessionStorage.setItem(
      v3TabsKey,
      JSON.stringify({ owner: owner.value, paths: tabs.value.map(({ key }) => key) })
    )
  }
}

watch(
  [owner, () => route.fullPath],
  () => {
    if (owner.value !== currentOwner) {
      currentOwner = owner.value
      tabs.value = currentOwner ? restoreTabs() : []
    }
    if (currentOwner && tabInfo(route.path)) {
      tabs.value = visit(tabs.value, route.path, route.fullPath)
      saveTabs()
    }
  },
  { immediate: true }
)

async function closeTab(tab: V3Tab) {
  const remaining = tabs.value.filter(({ key }) => key !== tab.key)
  if (tab.key === route.path) {
    const destination = remaining[0]?.target ?? '/dashboard'
    if (destination !== route.fullPath && (await router.push(destination))) return
    tabs.value = tabs.value.filter(({ key }) => key !== tab.key || key === route.path)
  } else {
    tabs.value = remaining
  }
  saveTabs()
}

function isSection(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}

function toggleNav() {
  if (tier.value.name !== 'mobile') {
    collapsed.value = !collapsed.value
  } else if (drawer.value && !drawer.value.open) {
    drawer.value.showModal()
    drawerOpen.value = true
  }
}

function dismissDrawer() {
  drawer.value?.close()
}

function onDrawerClosed() {
  drawerOpen.value = false
  navToggle.value?.focus()
}

function closeOverflow(restoreFocus = true) {
  if (!more.value?.open) return
  more.value.open = false
  if (restoreFocus) more.value.querySelector('summary')?.focus()
}

watch(
  () => tier.value.name,
  (name) => {
    collapsed.value = name !== 'desktop'
    dismissDrawer()
    closeOverflow(false)
  }
)

function logout() {
  if (confirmV3Leave()) v3Session.clear()
}

function revalidate() {
  if (document.visibilityState === 'visible') void v3Session.refresh()
}

const observer = new ResizeObserver(([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
let timer: number
onMounted(() => {
  if (root.value) observer.observe(root.value)
  window.addEventListener('focus', revalidate)
  document.addEventListener('visibilitychange', revalidate)
  timer = window.setInterval(revalidate, 15000)
})
onUnmounted(() => {
  observer.disconnect()
  window.removeEventListener('focus', revalidate)
  document.removeEventListener('visibilitychange', revalidate)
  window.clearInterval(timer)
})
</script>
