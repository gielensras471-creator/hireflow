<template>
  <div class="profile-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div>
        <h2>个人中心</h2>
        <p>管理个人资料与账号安全设置</p>
      </div>
    </div>

    <!-- 用户摘要 -->
    <div class="profile-summary">
      <el-avatar :size="72" class="profile-avatar">
        {{ avatarText }}
      </el-avatar>

      <div class="summary-content">
        <div class="summary-title">
          <h3>
            {{ profile.name }}
          </h3>

          <el-tag type="primary" effect="light">
            {{ profile.role }}
          </el-tag>
        </div>

        <p class="summary-username">@{{ profile.username }}</p>

        <div class="summary-meta">
          <span>
            {{ profile.department }}
          </span>

          <span class="meta-divider"> · </span>

          <span>
            {{ profile.email }}
          </span>
        </div>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="profile-grid">
      <!-- 基本资料 -->
      <section class="profile-card">
        <div class="card-header">
          <div>
            <h3>基本资料</h3>
            <p>查看和维护个人基本信息</p>
          </div>

          <el-button type="primary" plain @click="editDialogVisible = true"> 编辑资料 </el-button>
        </div>

        <el-descriptions :column="2" border class="profile-descriptions">
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
      </section>

      <!-- 账号安全 -->
      <section class="profile-card">
        <div class="card-header">
          <div>
            <h3>账号安全</h3>
            <p>管理账号登录与安全设置</p>
          </div>
        </div>

        <div class="security-list">
          <!-- 登录账号 -->
          <div class="security-item">
            <div class="security-main">
              <div class="security-icon">A</div>

              <div>
                <strong> 登录账号 </strong>

                <p>当前用于登录 HireFlow 的账号</p>
              </div>
            </div>

            <div class="security-value">@{{ profile.username }}</div>
          </div>

          <!-- 登录密码 -->
          <div class="security-item">
            <div class="security-main">
              <div class="security-icon">P</div>

              <div>
                <strong> 登录密码 </strong>

                <p>建议定期修改密码，提高账号安全性</p>
              </div>
            </div>

            <div class="security-action">
              <span> ******** </span>

              <el-button link type="primary" @click="passwordDialogVisible = true">
                修改密码
              </el-button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 编辑资料 -->
    <ProfileEditDialog
      v-model="editDialogVisible"
      :profile="profile"
      :submitting="profileSubmitting"
      @submit="handleUpdateProfile"
    />

    <!-- 修改密码 -->
    <PasswordDialog
      v-model="passwordDialogVisible"
      :submitting="passwordSubmitting"
      @submit="handleChangePassword"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useRoute } from 'vue-router'

import { storeToRefs } from 'pinia'

import axios from 'axios'

import { ElMessage } from 'element-plus'

import { useProfileStore } from '@/stores/profile'

import type { ProfileFormData, PasswordFormData } from '@/types/profile'

import ProfileEditDialog from './components/ProfileEditDialog.vue'
import PasswordDialog from './components/PasswordDialog.vue'

const profileStore = useProfileStore()

const route = useRoute()

const { profile } = storeToRefs(profileStore)

const editDialogVisible = ref(false)

const passwordDialogVisible = ref(false)

const profileSubmitting = ref(false)

const passwordSubmitting = ref(false)

/*
 * Header 中点击“修改密码”时会跳转：
 * /profile?action=password
 *
 * 这里监听 query，
 * 自动打开修改密码弹窗。
 */
watch(
  () => route.query.action,
  (action) => {
    if (action === 'password') {
      passwordDialogVisible.value = true
    }
  },
  {
    immediate: true
  }
)

const avatarText = computed(() => {
  return profile.value.name.trim().slice(0, 1) || 'H'
})

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || fallback
  }

  return fallback
}

const handleUpdateProfile = async (data: ProfileFormData) => {
  if (profileSubmitting.value) return

  profileSubmitting.value = true

  try {
    await profileStore.updateProfile(data)
    ElMessage.success('个人资料修改成功')
    editDialogVisible.value = false
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '个人资料修改失败，请稍后重试'))
  } finally {
    profileSubmitting.value = false
  }
}

const handleChangePassword = async (data: PasswordFormData) => {
  if (passwordSubmitting.value) return

  passwordSubmitting.value = true

  try {
    const result = await profileStore.changePassword(data)
    ElMessage.success(result.message)
    passwordDialogVisible.value = false
  } catch (error) {
    ElMessage.error(getErrorMessage(error, '密码修改失败，请稍后重试'))
  } finally {
    passwordSubmitting.value = false
  }
}
</script>

<style scoped lang="scss">
.profile-page {
  width: 100%;
}

/* =====================
   页面标题
===================== */

.page-header {
  margin-bottom: 18px;
}

.page-header h2 {
  margin: 0 0 5px;

  color: var(--el-text-color-primary);

  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
}

.page-header p {
  margin: 0;

  color: var(--el-text-color-secondary);

  font-size: 13px;
}

/* =====================
   用户摘要
===================== */

.profile-summary {
  box-sizing: border-box;

  display: flex;
  align-items: center;

  min-height: 124px;

  padding: 22px 24px;
  margin-bottom: 16px;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;
}

.profile-avatar {
  flex: 0 0 auto;

  color: #fff;
  font-size: 24px;
  font-weight: 600;

  background: var(--el-color-primary);

  box-shadow: 0 8px 22px rgb(34 84 244 / 16%);
}

.summary-content {
  min-width: 0;
  margin-left: 20px;
}

.summary-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary-title h3 {
  margin: 0;

  color: var(--el-text-color-primary);

  font-size: 20px;
  font-weight: 700;
}

.summary-username {
  margin: 7px 0 9px;

  color: var(--el-text-color-secondary);

  font-size: 13px;
}

.summary-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;

  color: var(--el-text-color-regular);

  font-size: 13px;
}

.meta-divider {
  color: var(--el-text-color-placeholder);
}

/* =====================
   下方双栏
===================== */

.profile-grid {
  display: grid;

  grid-template-columns:
    minmax(0, 1fr)
    minmax(0, 1fr);

  gap: 16px;

  align-items: stretch;
}

/* =====================
   通用卡片
===================== */

.profile-card {
  box-sizing: border-box;

  min-width: 0;
  min-height: 286px;

  padding: 22px;

  background: var(--el-bg-color);

  border: 1px solid var(--el-border-color-lighter);

  border-radius: 12px;

  transition:
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.profile-card:hover {
  border-color: var(--el-border-color);

  box-shadow: 0 8px 26px rgb(31 35 48 / 4%);
}

/* =====================
   卡片 Header
===================== */

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;

  gap: 16px;

  margin-bottom: 20px;
}

.card-header h3 {
  margin: 0 0 5px;

  color: var(--el-text-color-primary);

  font-size: 16px;
  font-weight: 650;
}

.card-header p {
  margin: 0;

  color: var(--el-text-color-secondary);

  font-size: 12px;
}

.card-header :deep(.el-button) {
  flex: 0 0 auto;

  height: 34px;

  border-radius: 8px;
}

/* =====================
   基本资料
===================== */

.profile-descriptions {
  width: 100%;
}

.profile-descriptions :deep(.el-descriptions__label) {
  width: 90px;

  color: var(--el-text-color-secondary);

  font-weight: 500;

  background: var(--el-fill-color-lighter) !important;
}

.profile-descriptions :deep(.el-descriptions__content) {
  color: var(--el-text-color-regular);
}

.profile-descriptions :deep(.el-descriptions__cell) {
  height: 48px;
}

/* =====================
   账号安全
===================== */

.security-list {
  border-top: 1px solid var(--el-border-color-lighter);
}

.security-item {
  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 20px;

  min-height: 76px;

  padding: 14px 0;

  border-bottom: 1px solid var(--el-border-color-lighter);
}

.security-main {
  display: flex;
  align-items: center;
  gap: 13px;

  min-width: 0;
}

.security-icon {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;

  width: 38px;
  height: 38px;

  color: var(--el-color-primary);

  font-size: 13px;
  font-weight: 700;

  background: var(--el-color-primary-light-9);

  border-radius: 10px;
}

.security-main strong {
  color: var(--el-text-color-primary);

  font-size: 14px;
  font-weight: 600;
}

.security-main p {
  margin: 5px 0 0;

  color: var(--el-text-color-secondary);

  font-size: 12px;
  line-height: 1.5;
}

.security-value {
  flex: 0 0 auto;

  color: var(--el-text-color-regular);

  font-size: 13px;
}

.security-action {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 16px;
}

.security-action span {
  color: var(--el-text-color-secondary);

  font-size: 13px;
  letter-spacing: 2px;
}

/* =====================
   响应式
===================== */

@media (max-width: 1200px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }

  .profile-card {
    min-height: auto;
  }
}

@media (max-width: 768px) {
  .profile-summary {
    align-items: flex-start;

    padding: 18px;

    min-height: auto;
  }

  .profile-avatar {
    width: 58px !important;
    height: 58px !important;

    font-size: 20px;
  }

  .summary-content {
    margin-left: 14px;
  }

  .summary-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .profile-card {
    padding: 18px 16px;
  }

  .card-header {
    align-items: flex-start;
  }

  .security-item {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .security-value,
  .security-action {
    margin-left: 51px;
  }
}
</style>
