<template>
  <el-dialog :model-value="modelValue" :title="dialogTitle" width="560px" @close="handleClose">
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="90px">
      <el-form-item label="职位名称" prop="title">
        <el-input v-model="formData.title" placeholder="请输入职位名称" />
      </el-form-item>

      <el-form-item label="所属部门" prop="department">
        <el-select v-model="formData.department" placeholder="请选择部门" style="width: 100%">
          <el-option label="技术部" value="技术部" />
          <el-option label="产品部" value="产品部" />
          <el-option label="设计部" value="设计部" />
          <el-option label="运营部" value="运营部" />
        </el-select>
      </el-form-item>

      <el-form-item label="工作地点" prop="location">
        <el-input v-model="formData.location" placeholder="例如：深圳" />
      </el-form-item>

      <el-form-item label="职位状态" prop="status">
        <el-radio-group v-model="formData.status">
          <el-radio value="open">招聘中</el-radio>
          <el-radio value="closed">已关闭</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="职位描述" prop="description">
        <el-input
          v-model="formData.description"
          type="textarea"
          :rows="4"
          placeholder="请输入职位描述"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose"> 取消 </el-button>

      <el-button type="primary" :loading="props.submitting" @click="handleSubmit">
        {{ position ? '保存修改' : '确认创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'

import type { FormInstance, FormRules } from 'element-plus'

import type { Position, PositionFormData } from '@/types/position'

const props = defineProps<{
  modelValue: boolean
  position: Position | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [data: PositionFormData]
}>()

const formRef = ref<FormInstance>()

const formData = reactive<PositionFormData>({
  title: '',
  department: '',
  location: '',
  status: 'open',
  description: ''
})

const dialogTitle = computed(() => {
  return props.position ? '编辑职位' : '新建职位'
})

const rules: FormRules<PositionFormData> = {
  title: [
    {
      required: true,
      message: '请输入职位名称',
      trigger: 'blur'
    },
    {
      min: 2,
      max: 30,
      message: '职位名称长度为 2-30 个字符',
      trigger: 'blur'
    }
  ],

  department: [
    {
      required: true,
      message: '请选择所属部门',
      trigger: 'change'
    }
  ],

  location: [
    {
      required: true,
      message: '请输入工作地点',
      trigger: 'blur'
    }
  ],

  description: [
    {
      required: true,
      message: '请输入职位描述',
      trigger: 'blur'
    },
    {
      min: 5,
      max: 200,
      message: '职位描述长度为 5-200 个字符',
      trigger: 'blur'
    }
  ]
}

const resetFormData = () => {
  Object.assign(formData, {
    title: '',
    department: '',
    location: '',
    status: 'open',
    description: ''
  })
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return

    if (props.position) {
      Object.assign(formData, {
        title: props.position.title,
        department: props.position.department,
        location: props.position.location,
        status: props.position.status,
        description: props.position.description
      })
    } else {
      resetFormData()
    }

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
