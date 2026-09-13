<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="680px"
    @close="handleClose"
  >
    <el-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      label-width="90px"
    >
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="姓名" prop="name">
            <el-input
              v-model="formData.name"
              placeholder="请输入候选人姓名"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="应聘职位" prop="position">
            <el-select
              v-model="formData.position"
              placeholder="请选择职位"
              style="width: 100%"
            >
              <el-option label="前端开发工程师" value="前端开发工程师" />
              <el-option label="Java 后端工程师" value="Java 后端工程师" />
              <el-option label="UI 设计师" value="UI 设计师" />
              <el-option label="产品助理" value="产品助理" />
              <el-option label="测试工程师" value="测试工程师" />
              <el-option label="运营专员" value="运营专员" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="学历" prop="education">
            <el-select
              v-model="formData.education"
              placeholder="请选择学历"
              style="width: 100%"
            >
              <el-option label="大专" value="大专" />
              <el-option label="本科" value="本科" />
              <el-option label="硕士" value="硕士" />
              <el-option label="博士" value="博士" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="毕业院校" prop="school">
            <el-input
              v-model="formData.school"
              placeholder="请输入毕业院校"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="手机号" prop="phone">
            <el-input
              v-model="formData.phone"
              placeholder="请输入手机号"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="邮箱" prop="email">
            <el-input
              v-model="formData.email"
              placeholder="请输入邮箱"
            />
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="招聘阶段" prop="stage">
            <el-select
              v-model="formData.stage"
              placeholder="请选择阶段"
              style="width: 100%"
            >
              <el-option label="筛选中" value="screening" />
              <el-option label="初面" value="first_interview" />
              <el-option label="复面" value="second_interview" />
              <el-option label="Offer" value="offer" />
              <el-option label="已淘汰" value="rejected" />
            </el-select>
          </el-form-item>
        </el-col>

        <el-col :span="12">
          <el-form-item label="负责人" prop="owner">
            <el-input
              v-model="formData.owner"
              placeholder="例如：张经理"
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="技能" prop="skills">
        <el-input
          v-model="formData.skills"
          placeholder="例如：Vue3、TypeScript、JavaScript"
        />
      </el-form-item>

      <el-form-item label="项目经历" prop="experience">
        <el-input
          v-model="formData.experience"
          type="textarea"
          :rows="3"
          placeholder="请输入候选人的项目或工作经历"
        />
      </el-form-item>

      <el-form-item label="备注" prop="note">
        <el-input
          v-model="formData.note"
          type="textarea"
          :rows="3"
          placeholder="请输入招聘备注"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="handleClose">
        取消
      </el-button>

      <el-button
        type="primary"
        :loading="submitting"
        @click="handleSubmit"
      >
        {{ candidate ? '保存修改' : '确认新增' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  ref,
  watch
} from 'vue'

import type {
  FormInstance,
  FormRules
} from 'element-plus'

import type {
  Candidate,
  CandidateFormData
} from '@/types/candidate'

const props = defineProps<{
  modelValue: boolean
  candidate: Candidate | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [data: CandidateFormData]
}>()

const formRef = ref<FormInstance>()
const submitting = ref(false)

const formData = reactive<CandidateFormData>({
  name: '',
  position: '',
  education: '',
  school: '',
  phone: '',
  email: '',
  stage: 'screening',
  owner: '',
  skills: '',
  experience: '',
  note: ''
})

const dialogTitle = computed(() => {
  return props.candidate ? '编辑候选人' : '新增候选人'
})

const rules: FormRules<CandidateFormData> = {
  name: [
    {
      required: true,
      message: '请输入候选人姓名',
      trigger: 'blur'
    }
  ],

  position: [
    {
      required: true,
      message: '请选择应聘职位',
      trigger: 'change'
    }
  ],

  education: [
    {
      required: true,
      message: '请选择学历',
      trigger: 'change'
    }
  ],

  school: [
    {
      required: true,
      message: '请输入毕业院校',
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
  ],

  email: [
    {
      required: true,
      message: '请输入邮箱',
      trigger: 'blur'
    },
    {
      type: 'email',
      message: '请输入正确的邮箱格式',
      trigger: 'blur'
    }
  ],

  stage: [
    {
      required: true,
      message: '请选择招聘阶段',
      trigger: 'change'
    }
  ],

  owner: [
    {
      required: true,
      message: '请输入负责人',
      trigger: 'blur'
    }
  ]
}

const resetFormData = () => {
  Object.assign(formData, {
    name: '',
    position: '',
    education: '',
    school: '',
    phone: '',
    email: '',
    stage: 'screening',
    owner: '',
    skills: '',
    experience: '',
    note: ''
  })
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) return

    if (props.candidate) {
      Object.assign(formData, {
        name: props.candidate.name,
        position: props.candidate.position,
        education: props.candidate.education,
        school: props.candidate.school,
        phone: props.candidate.phone,
        email: props.candidate.email,
        stage: props.candidate.stage,
        owner: props.candidate.owner,
        skills: props.candidate.skills,
        experience: props.candidate.experience,
        note: props.candidate.note
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

  await formRef.value.validate((valid) => {
    if (!valid) return

    submitting.value = true

    emit('submit', {
      ...formData
    })

    submitting.value = false
    handleClose()
  })
}
</script>
