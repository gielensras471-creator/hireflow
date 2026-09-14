<template>
  <el-dropdown trigger="click" placement="bottom-end">
    <div class="user-trigger">
      <div class="avatar">
        {{ avatarText }}
      </div>

      <div class="user-copy">
        <strong>
          {{ username }}
        </strong>

        <span> 管理员账号 </span>
      </div>

      <i class="user-arrow iconfont icon-down"></i>
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

        <el-dropdown-item divided @click="logout">
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

import { ElMessage, ElMessageBox } from 'element-plus'

import { LOGIN_URL } from '@/config'

const router = useRouter()

const username = computed(() => {
  return localStorage.getItem('hireflow_username') || 'admin'
})

const avatarText = computed(() => {
  const value = username.value.trim()

  if (!value) {
    return 'H'
  }

  return value.slice(0, 1).toUpperCase()
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
    await ElMessageBox.confirm('您是否确认退出登录？', '退出登录', {
      confirmButtonText: '确认退出',

      cancelButtonText: '取消',

      type: 'warning'
    })

    localStorage.removeItem('hireflow_token')

    localStorage.removeItem('hireflow_username')

    ElMessage.success('退出登录成功')

    await router.replace(LOGIN_URL)
  } catch {
    // 用户取消退出
  }
}
</script>

<style scoped lang="scss">
.user-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  padding: 0 8px 0 4px;
  cursor: pointer;
  border-radius: 10px;
  outline: none;
  transition: background 0.2s ease;

  &:hover {
    background: var(--el-fill-color-light);
  }
}

.avatar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  background: var(--el-color-primary);
  border-radius: 10px;
}

.user-copy {
  display: flex;
  flex-direction: column;
  min-width: 58px;

  strong {
    color: var(--el-text-color-primary);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
  }

  span {
    margin-top: 3px;
    color: var(--el-text-color-secondary);
    font-size: 11px;
    line-height: 1;
  }
}

.user-arrow {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

.el-dropdown-menu__item span {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 768px) {
  .user-copy,
  .user-arrow {
    display: none;
  }
}
</style>
