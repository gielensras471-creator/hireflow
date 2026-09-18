<template>
  <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="hf-login-form" @submit.prevent="submit">
    <el-form-item label="账号" prop="username">
      <el-input v-model.trim="form.username" size="large" autocomplete="username" placeholder="请输入账号">
        <template #prefix>
          <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5.5 19c.8-3.7 3.1-5.5 6.5-5.5s5.7 1.8 6.5 5.5" />
          </svg>
        </template>
      </el-input>
    </el-form-item>

    <el-form-item label="密码" prop="password">
      <el-input
        v-model="form.password"
        size="large"
        type="password"
        autocomplete="current-password"
        show-password
        placeholder="请输入密码"
        @keyup.enter="submit"
      >
        <template #prefix>
          <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="10" width="12" height="9" rx="2" />
            <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
          </svg>
        </template>
      </el-input>
    </el-form-item>

    <div class="login-options">
      <el-checkbox v-model="form.remember">7 天内保持登录</el-checkbox>
      <span>JWT 认证</span>
    </div>

    <div class="login-actions">
      <el-button size="large" @click="reset">重置</el-button>
      <el-button type="primary" size="large" :loading="submitting" @click="submit">进入工作台</el-button>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import axios from 'axios'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { loginApi } from '@/api/modules/auth'
import { APP_HOME } from '@/config'
import { useProfileStore } from '@/stores/profile'
import { saveSession } from '@/utils/auth'

interface LoginFormData {
  username: string
  password: string
  remember: boolean
}

const route = useRoute()
const router = useRouter()
const profileStore = useProfileStore()
const formRef = ref<FormInstance>()
const submitting = ref(false)

const form = reactive<LoginFormData>({
  username: 'admin',
  password: '123456',
  remember: true
})

const rules: FormRules<LoginFormData> = {
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { min: 2, max: 20, message: '账号长度为 2-20 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' }
  ]
}

const getErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || '登录失败，请确认 API 服务已启动'
  }

  return '登录失败，请稍后重试'
}

const submit = async () => {
  if (!formRef.value || submitting.value) return

  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitting.value = true

  try {
    const result = await loginApi({
      username: form.username,
      password: form.password,
      remember: form.remember
    })

    saveSession(
      {
        token: result.token,
        username: result.user.username,
        expiresAt: result.expiresAt
      },
      form.remember
    )

    await profileStore.fetchProfile(true)

    ElMessage.success('登录成功')

    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : APP_HOME
    await router.replace(redirect)
  } catch (error) {
    ElMessage.error(getErrorMessage(error))
  } finally {
    submitting.value = false
  }
}

const reset = () => {
  formRef.value?.resetFields()
}
</script>

<style scoped lang="scss">
.hf-login-form {
  margin-top: 28px;
}

.field-icon {
  width: 17px;
  height: 17px;
  color: #98a2b3;
  fill: none;
  stroke: currentcolor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -2px 0 22px;
  color: #98a2b3;
  font-size: 11px;
}

.login-actions {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  gap: 10px;

  :deep(.el-button) {
    width: 100%;
    margin: 0;
  }
}

@media (max-width: 520px) {
  .login-actions {
    grid-template-columns: 1fr;
  }
}
</style>
