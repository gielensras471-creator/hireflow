<template>
  <el-dialog :model-value="modelValue" title="修改密码" width="500px" @close="handleClose">
    <el-alert
      title="当前账号已接入真实后端认证；演示账号初始密码为 123456"
      type="info"
      :closable="false"
      class="password-tip"
    />

    <el-form ref="formRef" :model="formData" :rules="rules" label-width="100px">
      <el-form-item label="当前密码" prop="currentPassword">
        <el-input
          v-model="formData.currentPassword"
          type="password"
          show-password
          placeholder="请输入当前密码"
        />
      </el-form-item>

      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="formData.newPassword"
          type="password"
          show-password
          placeholder="至少 6 位字符"
        />
      </el-form-item>

      <el-form-item label="确认密码" prop="confirmPassword">
        <el-input
          v-model="formData.confirmPassword"
          type="password"
          show-password
          placeholder="请再次输入新密码"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose"> 取消 </el-button>

      <el-button type="primary" :loading="props.submitting" @click="handleSubmit"> 确认修改 </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'

import type { FormInstance, FormRules } from 'element-plus'

import type { PasswordFormData } from '@/types/profile'

const props = defineProps<{
  modelValue: boolean
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [data: PasswordFormData]
}>()

const formRef = ref<FormInstance>()

const formData = reactive<PasswordFormData>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (
  _rule: unknown,
  value: string,
  callback: (error?: Error) => void
) => {
  if (!value) {
    callback(new Error('请再次输入新密码'))

    return
  }

  if (value !== formData.newPassword) {
    callback(new Error('两次输入的密码不一致'))

    return
  }

  callback()
}

const rules: FormRules<PasswordFormData> = {
  currentPassword: [
    {
      required: true,
      message: '请输入当前密码',
      trigger: 'blur'
    }
  ],

  newPassword: [
    {
      required: true,
      message: '请输入新密码',
      trigger: 'blur'
    },
    {
      min: 6,
      message: '密码至少需要 6 位',
      trigger: 'blur'
    }
  ],

  confirmPassword: [
    {
      validator: validateConfirmPassword,
      trigger: 'blur'
    }
  ]
}

const resetForm = () => {
  Object.assign(formData, {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return

    resetForm()

    await nextTick()

    formRef.value?.clearValidate()
  }
)

const handleClose = () => {
  emit('update:modelValue', false)
}

const handleSubmit = async () => {
  if (!formRef.value) return

  const valid = await formRef.value.validate().catch(() => false)

  if (!valid) return

  emit('submit', {
    ...formData
  })
}
</script>

<style scoped lang="scss">
.password-tip {
  margin-bottom: 20px;
}
</style>
