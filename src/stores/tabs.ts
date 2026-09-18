import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface WorkspaceTab {
  title: string
  path: string
  closable: boolean
}

const STORAGE_KEY = 'hireflow_tabs'
const HOME_TAB: WorkspaceTab = {
  title: '工作台',
  path: '/dashboard',
  closable: false
}

const readStoredTabs = (): WorkspaceTab[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [HOME_TAB]

    const parsed = JSON.parse(raw) as WorkspaceTab[]
    const validTabs = parsed.filter((item) => item?.path && item?.title)

    return validTabs.some((item) => item.path === HOME_TAB.path)
      ? validTabs
      : [HOME_TAB, ...validTabs]
  } catch {
    return [HOME_TAB]
  }
}

export const useTabsStore = defineStore('hireflow-tabs', () => {
  const tabs = ref<WorkspaceTab[]>(readStoredTabs())

  const addTab = (tab: WorkspaceTab) => {
    const existing = tabs.value.find((item) => item.path === tab.path)

    if (existing) {
      existing.title = tab.title
      return
    }

    tabs.value.push(tab)
  }

  const updateTabTitle = (tabPath: string, title: string) => {
    const target = tabs.value.find((item) => item.path === tabPath)
    if (target) target.title = title
  }

  const removeTab = (tabPath: string) => {
    const index = tabs.value.findIndex((item) => item.path === tabPath)
    if (index === -1 || !tabs.value[index].closable) return undefined

    tabs.value.splice(index, 1)

    return tabs.value[index] || tabs.value[index - 1] || HOME_TAB
  }

  const closeOthers = (currentPath: string) => {
    tabs.value = tabs.value.filter((item) => !item.closable || item.path === currentPath)
  }

  watch(
    tabs,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true }
  )

  return {
    tabs,
    addTab,
    updateTabTitle,
    removeTab,
    closeOthers
  }
})
