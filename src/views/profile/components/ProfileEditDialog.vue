<template>
  <el-dialog :model-value="modelValue" title="编辑个人资料" width="520px" @close="handleClose">
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="90px">
      <el-form-item label="姓名" prop="name">
        <el-input v-model="formData.name" placeholder="请输入姓名" />
      </el-form-item>

      <el-form-item label="账号">
        <el-input :model-value="profile.username" disabled />
      </el-form-item>

      <el-form-item label="部门" prop="department">
        <el-select v-model="formData.department" placeholder="请选择部门" style="width: 100%">
          <el-option label="人力资源部" value="人力资源部" />

          <el-option label="技术部" value="技术部" />

          <el-option label="产品部" value="产品部" />

          <el-option label="设计部" value="设计部" />

          <el-option label="运营部" value="运营部" />
        </el-select>
      </el-form-item>

      <el-form-item label="邮箱" prop="email">
        <el-input v-model="formData.email" placeholder="请输入邮箱" />
      </el-form-item>

      <el-form-item label="手机号" prop="phone">
        <el-input v-model="formData.phone" placeholder="请输入手机号" maxlength="11" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose"> 取消 </el-button>

      <el-button type="primary" @click="handleSubmit"> 保存修改 </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'

import type { FormInstance, FormRules } from 'element-plus'

import type { UserProfile, ProfileFormData } from '@/types/profile'

const props = defineProps<{
  modelValue: boolean
  profile: UserProfile
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [data: ProfileFormData]
}>()

const formRef = ref<FormInstance>()

const formData = reactive<ProfileFormData>({
  name: '',
  department: '',
  email: '',
  phone: ''
})

const rules: FormRules<ProfileFormData> = {
  name: [
    {
      required: true,
      message: '请输入姓名',
      trigger: 'blur'
    }
  ],

  department: [
    {
      required: true,
      message: '请选择部门',
      trigger: 'change'
    }
  ],

  email: [
    {
      required: true,
      message: '请输入邮箱',
      trigger: 'blur'
    },
    {
      type: 'email',
      message: '请输入正确的邮箱地址',
      trigger: 'blur'
    }
  ],

  phone: [
    {
      required: true,
      message: '请输入手机号',
      trigger: 'blur'
    },
    {
      pattern: /^1[3-9]\d{9}$/,
      message: '请输入正确的手机号',
      trigger: 'blur'
    }
  ]
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return

    Object.assign(formData, {
      name: props.profile.name,
      department: props.profile.department,
      email: props.profile.email,
      phone: props.profile.phone
    })

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

  handleClose()
}
</script>
