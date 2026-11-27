<template>
  <div ref="root" class="v3-ui v3-shell v4-shell" :data-tier="tier.name">
    <template v-if="user">
      <header class="v3-header">
        <div class="v3-header-start">
          <template v-if="tier.name === 'mobile'">
            <button
              ref="navToggle"
              type="button"
              class="v3-icon-button"
              :aria-label="navigationLabel"
              :aria-expanded="tier.name === 'mobile' ? drawerOpen : !collapsed"
              @click="toggleNav"
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
              >
                <path
                  :d="
                    tier.name === 'mobile'
                      ? 'M4 6h16M4 12h16M4 18h16'
                      : 'M3 4h18v16H3z M9 4v16 M12 9l3 3-3 3'
                  "
                />
              </svg>
            </button>
          </template>
          <span class="v3-brand" aria-label="HireFlow">
            <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M8 0h16l8 8v16l-8 8H8l-8-8V8z" />
              <path fill="none" stroke="#fff" stroke-width="2" d="M9 7v18m14-18v18M9 16h14" />
            </svg>
            <span>HireFlow</span>
          </span>
        </div>
        <div ref="tabBar" class="v3-tabs" aria-label="已打开页面" @keydown.esc="closeOverflow()">
          <div
            v-for="tab in visible"
            :key="tab.key"
            class="v3-tab"
            :class="{ 'is-active': tab.key === route.path }"
          >
            <RouterLink
              :to="tab.target"
              :title="tab.title"
              :aria-current="tab.key === route.path ? 'page' : undefined"
              >{{ tab.title }}</RouterLink
            >
            <button type="button" :aria-label="'关闭 ' + tab.title" @click="closeTab(tab, $event)">
              ×
            </button>
          </div>
          <details v-if="overflow.length" ref="more" class="v3-more">
            <summary>更多页面 <span aria-hidden="true">▾</span></summary>
            <ul>
              <li v-for="tab in overflow" :key="tab.key">
                <RouterLink v-slot="{ href }" :to="tab.target" custom>
                  <a :href="href" :title="tab.title" @click="selectOverflow($event, tab)">
                    {{ tab.title }}
                  </a>
                </RouterLink>
                <button
                  type="button"
                  :aria-label="'关闭 ' + tab.title"
                  @click="closeTab(tab, $event)"
                >
                  ×
                </button>
              </li>
            </ul>
          </details>
        </div>
        <div class="v3-account">
          <span v-if="demoBuild" class="v4-demo-badge">公开演示</span>
          <button
            v-if="fullscreenSupported"
            class="v3-icon-button v4-fullscreen"
            type="button"
            :title="fullscreen ? '退出全屏' : '进入全屏'"
            :aria-label="fullscreen ? '退出全屏' : '进入全屏'"
            :disabled="fullscreenPending"
            @click="toggleFullscreen"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              aria-hidden="true"
            >
              <path
                :d="
                  fullscreen
                    ? 'M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5'
                    : 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'
                "
              />
            </svg>
          </button>
          <span v-if="fullscreenError" class="v4-fullscreen-status" role="status">{{
            fullscreenError
          }}</span>
          <RouterLink
            to="/profile"
            :title="accountName + ' · ' + user.role"
          >
            <span class="v4-account-avatar" aria-hidden="true">{{ accountName.slice(0, 1) }}</span>
            <span class="v4-account-label"
              >{{ accountName }} <small>{{ user.role }}</small></span
            >
            <span class="v4-account-destination">个人中心</span>
          </RouterLink>
          <button
            v-if="tier.name === 'mobile'"
            class="v3-icon-button v4-exit"
            type="button"
            @click="logout"
          >
            退出
          </button>
        </div>
      </header>

      <aside
        v-if="tier.name !== 'mobile'"
        class="v3-sidebar"
        :class="{ 'is-collapsed': collapsed }"
      >
        <nav aria-label="业务导航">
          <RouterLink
            v-for="section in v3Sections"
            :key="section.path"
            :to="section.path"
            :aria-label="section.title"
            :title="section.title"
            :class="{ 'is-current': isSection(section.path) }"
            :aria-current="isSection(section.path) ? 'page' : undefined"
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
        <div class="v4-rail-toggle">
          <button
            ref="navToggle"
            type="button"
            class="v3-icon-button"
            :aria-label="navigationLabel"
            :aria-expanded="tier.name === 'mobile' ? drawerOpen : !collapsed"
            @click="toggleNav"
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
            >
              <path
                :d="
                  tier.name === 'mobile'
                    ? 'M4 6h16M4 12h16M4 18h16'
                    : 'M3 4h18v16H3z M9 4v16 M12 9l3 3-3 3'
                "
              />
            </svg>
          </button>
        </div>
        <div class="v4-rail-account">
          <RouterLink
            class="v3-icon-button"
            to="/profile"
            :class="{ 'is-current': route.name === 'v3-profile' }"
            aria-label="打开个人中心"
            title="个人中心"
          >
            <svg
              class="v3-nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path :d="profileIcon" />
            </svg>
          </RouterLink>
          <button
            class="v3-icon-button v4-exit"
            type="button"
            aria-label="退出"
            title="退出"
            @click="logout"
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
            >
              <path d="M10 4H5v16h5M10 12h10m-4-4 4 4-4 4" />
            </svg>
          </button>
        </div>
      </aside>

      <main ref="content" class="v3-content" tabindex="-1">
        <V3Feedback
          v-if="status === 'unavailable'"
          state="error"
          title="连接暂时中断，未保存内容已保留"
          :message="
            route.name === 'v3-profile'
              ? '恢复连接后可继续查看账号资料。'
              : '恢复连接后可继续编辑。'
          "
          action="重试连接"
          @action="v3Session.refresh()"
        />
        <div :inert="status !== 'ready'"><RouterView /></div>
      </main>

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
              :aria-current="isSection(section.path) ? 'page' : undefined"
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
            <RouterLink
              to="/profile"
              :class="{ 'is-current': route.name === 'v3-profile' }"
              @click="dismissDrawer"
            >
              <svg
                class="v3-nav-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path :d="profileIcon" />
              </svg>
              个人中心
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
import '../styles/_v4-shell.scss'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v3Session } from '../api/request-v3'
import V3Feedback from '../components/V3Feedback.vue'
import { confirmV3Leave } from '../router/v3-drafts'
import {
  safeReturn,
  shellTier,
  tabInfo,
  visit,
  visibleTabs,
  v3Sections,
  type V3Tab
} from '../router/v3-navigation'
import { positionTabTitle } from '../router/v4-position-navigation'
import { v3TabsKey } from '../utils/auth-v3'

const demoBuild = import.meta.env.MODE === 'v3-demo'
const route = useRoute()
const router = useRouter()
const user = computed(() => v3Session.state.user)
const accountName = computed(() => user.value?.name?.trim() || user.value?.username || '未提供')
const status = computed(() => v3Session.state.status)
const owner = computed(() => user.value && user.value.id + ':' + user.value.username)
const root = ref<HTMLElement>()
const content = ref<HTMLElement>()
const navToggle = ref<HTMLButtonElement>()
const drawer = ref<HTMLDialogElement>()
const more = ref<HTMLDetailsElement>()
const tabBar = ref<HTMLElement>()
const drawerOpen = ref(false)
const width = ref(window.innerWidth)
const tier = computed(() => shellTier(width.value))
const profileIcon = 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM5 21v-2a7 7 0 0 1 14 0v2'
const collapsed = ref(true)
const navigationLabel = computed(() =>
  tier.value.name === 'mobile' ? '打开导航' : collapsed.value ? '展开导航' : '折叠导航'
)
const tabs = ref<V3Tab[]>([])
provide(positionTabTitle, (path, title) => {
  const tab = tabs.value.find(({ key }) => key === path)
  if (tab) {
    tab.title = title
    saveTabs()
  }
})
const { visible, overflow } = {
  visible: computed(() => visibleTabs(tabs.value, tier.value.limit).visible),
  overflow: computed(() => visibleTabs(tabs.value, tier.value.limit).overflow)
}
const icons = {
  dashboard: 'M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z',
  positions: 'M3 7h18v14H3z M8 7V4h8v3 M3 12h18 M10 12v2h4v-2',
  candidates:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 8',
  legacy: 'M4 4h16v5H4z M6 9v12h12V9 M10 13h4',
  interviews: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M7 14h2 M12 14h2 M7 17h2'
}
let currentOwner: string | null = null

function restoreTabs() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(v3TabsKey) ?? 'null')
    if (saved?.owner === owner.value && Array.isArray(saved.paths)) {
      return saved.paths
        .filter((path: unknown): path is string => typeof path === 'string')
        .reduceRight((result: V3Tab[], path: string) => {
          const record = path.startsWith('/positions/') ? saved.positions?.[path] : null
          const target = safeReturn(record?.target ?? saved.views?.[path])
          const next = visit(result, path, target.split(/[?#]/, 1)[0] === path ? target : path)
          if (record && typeof record.title === 'string' && next[0]?.key === path)
            next[0].title = record.title
          return next
        }, [])
    }
  } catch {
    // Malformed tab state has no bearing on authentication or navigation.
  }
  return []
}

function saveTabs() {
  if (owner.value) {
    try {
      sessionStorage.setItem(
        v3TabsKey,
        JSON.stringify({
          owner: owner.value,
          paths: tabs.value.map(({ key }) => key),
          views: Object.fromEntries(
            tabs.value
              .filter(({ key }) => key === '/candidates' || key === '/interviews')
              .map(({ key, target }) => [key, target])
          ),
          positions: Object.fromEntries(
            tabs.value
              .filter(({ key }) => key.startsWith('/positions/'))
              .map(({ key, title, target }) => [key, { title, target }])
          )
        })
      )
    } catch {
      /* Tabs remain usable in memory. */
    }
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
      const target =
        route.fullPath === route.path && route.path === '/candidates'
          ? '/candidates?view=board'
          : route.fullPath === route.path && route.path === '/interviews'
            ? '/interviews?view=week'
            : route.fullPath
      tabs.value = visit(tabs.value, route.path, target)
      saveTabs()
    }
  },
  { immediate: true }
)

function focusActiveTab() {
  tabBar.value?.querySelector<HTMLAnchorElement>('.v3-tab.is-active a')?.focus()
}

async function selectOverflow(event: MouseEvent, tab: V3Tab) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const link = event.currentTarget
  if (await router.push(tab.target)) return
  closeOverflow(false)
  await nextTick()
  if (document.activeElement === document.body || document.activeElement === link) focusActiveTab()
}

async function closeTab(tab: V3Tab, event: MouseEvent) {
  const button = event.currentTarget
  const restore = document.activeElement === button
  const remaining = tabs.value.filter(({ key }) => key !== tab.key)
  if (tab.key === route.path) {
    const destination = remaining[0]?.target ?? '/dashboard'
    if (destination !== route.fullPath && (await router.push(destination))) return
    tabs.value = tabs.value.filter(({ key }) => key !== tab.key || key === route.path)
  } else {
    tabs.value = remaining
  }
  saveTabs()
  if (restore) {
    await nextTick()
    if (document.activeElement === document.body) {
      const summary = more.value?.open && more.value.querySelector('summary')
      if (summary) summary.focus()
      else focusActiveTab()
    }
  }
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

async function onDrawerClosed() {
  drawerOpen.value = false
  await nextTick()
  navToggle.value?.focus()
}

function closeOverflow(restoreFocus = true) {
  if (!more.value?.open) return
  more.value.open = false
  if (restoreFocus) more.value.querySelector('summary')?.focus()
}

watch(
  () => tier.value.name,
  async () => {
    const restoreNavFocus = document.activeElement === navToggle.value || drawer.value?.open
    const restoreTabFocus = !!tabBar.value?.contains(document.activeElement)
    collapsed.value = true
    dismissDrawer()
    closeOverflow(false)
    await nextTick()
    if (restoreNavFocus) navToggle.value?.focus()
    else if (restoreTabFocus && !tabBar.value?.contains(document.activeElement)) focusActiveTab()
  }
)

watch(
  () => route.path,
  () => content.value?.scrollTo(0, 0)
)

function logout() {
  if (confirmV3Leave()) v3Session.clear()
}

provide('v3-shell-logout', logout)

function revalidate() {
  if (document.visibilityState === 'visible') void v3Session.refresh()
}

const observer = new ResizeObserver(([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
let timer: number
const fullscreenSupported = ref(false)
const fullscreen = ref(false)
const fullscreenPending = ref(false)
const fullscreenError = ref('')
let mounted = false
let ownsFullscreen = false
function syncFullscreen() {
  fullscreen.value = Boolean(document.fullscreenElement)
  if (!fullscreen.value) ownsFullscreen = false
}
async function toggleFullscreen() {
  if (!fullscreenSupported.value || fullscreenPending.value) return
  fullscreenPending.value = true
  fullscreenError.value = ''
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else {
      await document.documentElement.requestFullscreen()
      ownsFullscreen = true
      if (!mounted && document.fullscreenElement) await document.exitFullscreen()
    }
  } catch {
    if (mounted) fullscreenError.value = '浏览器未能切换全屏，请重试。'
  } finally {
    fullscreenPending.value = false
  }
}
onMounted(() => {
  mounted = true
  fullscreenSupported.value =
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof document.exitFullscreen === 'function'
  syncFullscreen()
  document.addEventListener('fullscreenchange', syncFullscreen)
  if (root.value) observer.observe(root.value)
  window.addEventListener('focus', revalidate)
  document.addEventListener('visibilitychange', revalidate)
  timer = window.setInterval(revalidate, 15000)
})
onUnmounted(() => {
  mounted = false
  document.removeEventListener('fullscreenchange', syncFullscreen)
  if (ownsFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  observer.disconnect()
  window.removeEventListener('focus', revalidate)
  document.removeEventListener('visibilitychange', revalidate)
  window.clearInterval(timer)
})
</script>
