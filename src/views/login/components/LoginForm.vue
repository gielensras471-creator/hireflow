<template>
  <el-form ref="loginFormRef" :model="account" :rules="rules">
    <el-form-item prop="username">
      <el-input v-model="account.username" placeholder="用户名">
        <template #prefix>
          <i class="iconfont icon-user"></i>
        </template>
      </el-input>
    </el-form-item>

    <el-form-item prop="password">
      <el-input
        v-model="account.password"
        type="password"
        show-password
        placeholder="密码"
      >
        <template #prefix>
          <i class="iconfont icon-lock"></i>
        </template>
      </el-input>
    </el-form-item>

    <el-form-item prop="expires7d">
      <el-checkbox v-model="account.expires7d" class="expires7d">
        7天免登录
      </el-checkbox>
    </el-form-item>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { useRouter } from 'vue-router'
import { HOME_URL } from '@/config'

const TOKEN_KEY = 'hireflow_token'

interface LoginFormData {
  username: string
  password: string
  expires7d: boolean
}

const router = useRouter()

const account = reactive<LoginFormData>({
  username: 'admin',
  password: '123456',
  expires7d: false
})

const rules = {
  username: [
    {
      required: true,
      message: '请输入账号名称',
      trigger: 'blur'
    },
    {
      min: 2,
      max: 20,
      message: '账号名称长度为2-20个字符',
      trigger: 'blur'
    }
  ],

  password: [
    {
      required: true,
      message: '请输入密码',
      trigger: 'blur'
    },
    {
      pattern: /^[a-zA-Z0-9]{6,}$/,
      message: '密码必须是6位以上的字母或数字',
      trigger: 'blur'
    }
  ]
}

const loginFormRef = ref<FormInstance>()

const loginAction = () => {
  loginFormRef.value?.validate(async (valid) => {
    if (!valid) return

    if (account.username !== 'admin' || account.password !== '123456') {
      ElMessage.error('账号或密码错误')
      return
    }

    localStorage.setItem(TOKEN_KEY, 'hireflow-demo-token')
    localStorage.setItem('hireflow_username', account.username)

    ElMessage.success('登录成功')

    await router.replace(HOME_URL)
  })
}

const resetAction = () => {
  loginFormRef.value?.resetFields()
}

defineExpose({
  loginAction,
  resetAction
})
</script>

<style lang="scss" scoped></style>