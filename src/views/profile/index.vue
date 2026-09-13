<template>
  <div class="profile-page">
    <div class="page-header">
      <div>
        <h2>个人中心</h2>
        <p>管理个人资料与账号安全设置</p>
      </div>
    </div>

    <div class="profile-layout">
      <!-- 左侧用户卡片 -->
      <div class="user-card">
        <el-avatar :size="82" class="avatar">
          {{ avatarText }}
        </el-avatar>

        <h3>
          {{ profile.name }}
        </h3>

        <p class="username">@{{ profile.username }}</p>

        <el-tag type="primary">
          {{ profile.role }}
        </el-tag>

        <div class="department">
          {{ profile.department }}
        </div>
      </div>

      <!-- 右侧 -->
      <div class="content-area">
        <!-- 基本资料 -->
        <div class="info-card">
          <div class="card-header">
            <div>
              <h3>基本资料</h3>

              <p>查看和维护个人基本信息</p>
            </div>

            <el-button type="primary" plain @click="editDialogVisible = true"> 编辑资料 </el-button>
          </div>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="姓名">
              {{ profile.name }}
            </el-descriptions-item>

            <el-descriptions-item label="账号">
              {{ profile.username }}
            </el-descriptions-item>

            <el-descriptions-item label="角色">
              {{ profile.role }}
            </el-descriptions-item>

            <el-descriptions-item label="部门">
              {{ profile.department }}
            </el-descriptions-item>

            <el-descriptions-item label="邮箱">
              {{ profile.email }}
            </el-descriptions-item>

            <el-descriptions-item label="手机号">
              {{ profile.phone }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 账号安全 -->
        <div class="security-card">
          <div class="card-header">
            <div>
              <h3>账号安全</h3>

              <p>管理账号登录与安全设置</p>
            </div>
          </div>

          <div class="security-item">
            <div>
              <strong>登录密码</strong>

              <p>建议定期修改密码，提高账号安全性</p>
            </div>

            <div class="security-action">
              <span>********</span>

              <el-button link type="primary" @click="passwordDialogVisible = true">
                修改密码
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ProfileEditDialog
      v-model="editDialogVisible"
      :profile="profile"
      @submit="handleUpdateProfile"
    />

    <PasswordDialog v-model="passwordDialogVisible" @submit="handleChangePassword" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { storeToRefs } from 'pinia'

import { ElMessage } from 'element-plus'

import { useProfileStore } from '@/store/modules/profile'

import type { ProfileFormData, PasswordFormData } from '@/types/profile'

import ProfileEditDialog from './components/ProfileEditDialog.vue'
import PasswordDialog from './components/PasswordDialog.vue'

const profileStore = useProfileStore()

const { profile } = storeToRefs(profileStore)

const editDialogVisible = ref(false)

const passwordDialogVisible = ref(false)

const avatarText = computed(() => {
  return profile.value.name.trim().slice(0, 1) || 'H'
})

const handleUpdateProfile = (data: ProfileFormData) => {
  profileStore.updateProfile(data)

  ElMessage.success('个人资料修改成功')
}

const handleChangePassword = (data: PasswordFormData) => {
  const result = profileStore.changePassword(data)

  if (!result.success) {
    ElMessage.error(result.message)

    return
  }

  ElMessage.success(result.message)

  passwordDialogVisible.value = false
}
</script>

<style scoped lang="scss">
.profile-page {
  width: 100%;
}

.page-header {
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0 0 6px;
  font-size: 22px;
}

.page-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.profile-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.user-card,
.info-card,
.security-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
}

.user-card {
  padding: 32px 20px;
  text-align: center;
}

.avatar {
  margin-bottom: 16px;
  font-size: 28px;
}

.user-card h3 {
  margin: 0 0 6px;
  font-size: 20px;
}

.username {
  margin: 0 0 14px;
  color: var(--el-text-color-secondary);
}

.department {
  margin-top: 16px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.content-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-card,
.security-card {
  padding: 22px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.card-header h3 {
  margin: 0 0 5px;
  font-size: 18px;
}

.card-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.security-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.security-item strong {
  font-size: 15px;
}

.security-item p {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.security-action {
  display: flex;
  gap: 20px;
  align-items: center;
}

.security-action span {
  color: var(--el-text-color-secondary);
  letter-spacing: 2px;
}

@media (max-width: 900px) {
  .profile-layout {
    grid-template-columns: 1fr;
  }

  .card-header,
  .security-item {
    align-items: flex-start;
  }

  .security-item {
    gap: 16px;
  }
}
</style>
