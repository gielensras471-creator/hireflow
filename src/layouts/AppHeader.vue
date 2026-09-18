<template>
  <header class="hf-header">
    <div class="hf-header__left">
      <button class="hf-icon-button" type="button" :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'" @click="emit('toggle-sidebar')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div class="hf-breadcrumb">
        <RouterLink to="/dashboard">工作台</RouterLink>
        <span v-if="pageTitle !== '工作台'">/</span>
        <strong v-if="pageTitle !== '工作台'">{{ pageTitle }}</strong>
      </div>
    </div>

    <div class="hf-header__right">
      <button class="hf-icon-button" type="button" aria-label="切换全屏" @click="toggleFullscreen">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path v-if="!isFullscreen" d="M8 3H3v5M16 3h5v5M8 21H3v-5m13 5h5v-5" />
          <path v-else d="M8 8H3V3m13 5h5V3M8 16H3v5m13-5h5v5" />
        </svg>
      </button>

      <span class="hf-header__divider" />

      <el-dropdown trigger="click" @command="handleCommand">
        <button class="hf-user" type="button">
          <span class="hf-user__avatar">{{ avatarText }}</span>
          <span class="hf-user__copy">
            <strong>{{ profileStore.profile.name }}</strong>
            <small>{{ profileStore.profile.role }}</small>
          </span>
          <span class="hf-user__chevron">⌄</span>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">个人中心</el-dropdown-item>
            <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { LOGIN_PATH } from '@/config'
import { useProfileStore } from '@/stores/profile'
import { clearSession } from '@/utils/auth'

defineProps<{
  collapsed: boolean
}>()

const emit = defineEmits<{
  'toggle-sidebar': []
}>()

const route = useRoute()
const router = useRouter()
const profileStore = useProfileStore()
const isFullscreen = ref(Boolean(document.fullscreenElement))

const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : 'HireFlow'))
const avatarText = computed(() => profileStore.profile.name.slice(0, 1).toUpperCase())

const syncFullscreen = () => {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

const toggleFullscreen = async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
  } catch {
    ElMessage.warning('当前浏览器无法切换全屏')
  }
}

const logout = async () => {
  try {
    await ElMessageBox.confirm('确定退出 HireFlow 吗？', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return
  }

  clearSession()
  profileStore.reset()
  ElMessage.success('已退出登录')
  await router.replace(LOGIN_PATH)
}

const handleCommand = async (command: string) => {
  if (command === 'profile') {
    await router.push('/profile')
  }

  if (command === 'logout') {
    await logout()
  }
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreen)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreen)
})

</script>
