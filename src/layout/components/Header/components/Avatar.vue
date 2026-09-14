<template>
  <el-dropdown trigger="click">
    <div class="user-trigger">
      <div class="avatar">
        H
      </div>

      <span class="username">
        {{ username }}
      </span>
    </div>

    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item @click="goProfile">
          <span>
            <i class="iconfont icon-user"></i>
            个人信息
          </span>
        </el-dropdown-item>

        <el-dropdown-item @click="goChangePassword">
          <span>
            <i class="iconfont icon-xiugai"></i>
            修改密码
          </span>
        </el-dropdown-item>

        <el-dropdown-item
          divided
          @click="logout"
        >
          <span>
            <i class="iconfont icon-tuichu"></i>
            退出登录
          </span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElMessage,
  ElMessageBox
} from 'element-plus'

import { LOGIN_URL } from '@/config'

const router = useRouter()

const username = computed(() => {
  return (
    localStorage.getItem(
      'hireflow_username'
    ) || 'admin'
  )
})

const goProfile = () => {
  router.push('/profile')
}

const goChangePassword = () => {
  router.push({
    path: '/profile',
    query: {
      action: 'password'
    }
  })
}

const logout = async () => {
  try {
    await ElMessageBox.confirm(
      '您是否确认退出登录？',
      '退出登录',
      {
        confirmButtonText: '确认退出',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    localStorage.removeItem(
      'hireflow_token'
    )

    localStorage.removeItem(
      'hireflow_username'
    )

    ElMessage.success(
      '退出登录成功'
    )

    await router.replace(
      LOGIN_URL
    )
  } catch {
    // 用户取消退出
  }
}
</script>

<style scoped lang="scss">
.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  background: #2254f4;
  border-radius: 50%;
}

.username {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.el-dropdown-menu__item span {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
