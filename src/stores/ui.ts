import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'hireflow_ui'

type StoredUiState = {
  sidebarCollapsed?: boolean
}

const readStoredState = (): StoredUiState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredUiState) : {}
  } catch {
    return {}
  }
}

export const useUiStore = defineStore('hireflow-ui', () => {
  const stored = readStoredState()
  const sidebarCollapsed = ref(Boolean(stored.sidebarCollapsed))

  const setSidebarCollapsed = (value: boolean) => {
    sidebarCollapsed.value = value
  }

  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  watch(
    sidebarCollapsed,
    (value) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sidebarCollapsed: value
        })
      )
    },
    { immediate: false }
  )

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar
  }
})
