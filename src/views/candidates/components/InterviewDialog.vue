<template>
  <el-dialog
    :model-value="modelValue"
    :title="dialogTitle"
    width="560px"
    :close-on-click-modal="!props.submitting"
    :close-on-press-escape="!props.submitting"
    @close="handleClose"
  >
    <el-form ref="formRef" :model="formData" :rules="rules" label-width="90px">
      <el-form-item label="候选人">
        <el-input :model-value="candidateName" disabled />
      </el-form-item>

      <el-form-item label="应聘职位">
        <el-input :model-value="positionName" disabled />
      </el-form-item>

      <el-form-item label="面试日期" prop="date">
        <el-date-picker
          v-model="formData.date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择面试日期"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="面试时间" prop="time">
        <el-time-select
          v-model="formData.time"
          start="09:00"
          step="00:30"
          end="18:00"
          placeholder="请选择面试时间"
          style="width: 100%"
        />
      </el-form-item>

      <el-form-item label="面试轮次" prop="type">
        <el-select v-model="formData.type" placeholder="请选择面试轮次" style="width: 100%">
          <el-option label="初面" value="初面" />

          <el-option label="复面" value="复面" />

          <el-option label="HR 面" value="HR 面" />
        </el-select>
      </el-form-item>

      <el-form-item label="面试官" prop="interviewer">
        <el-input v-model="formData.interviewer" placeholder="例如：张经理" />
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="formData.note" type="textarea" :rows="3" placeholder="请输入面试备注" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="props.submitting" @click="handleClose"> 取消 </el-button>

      <el-button type="primary" :loading="props.submitting" @click="handleSubmit">
        {{ interview ? '保存修改' : '确认安排' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'

import type { FormInstance, FormRules } from 'element-plus'

import type { Candidate } from '@/types/candidate'

import type { Interview, InterviewFormData } from '@/types/interview'

const props = defineProps<{
  modelValue: boolean
  candidate?: Candidate | null
  interview?: Interview | null
  submitting?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]

  submit: [data: InterviewFormData]
}>()

interface InterviewForm {
  date: string
  time: string
  interviewer: string
  type: string
  note: string
}

const formRef = ref<FormInstance>()

const formData = reactive<InterviewForm>({
  date: '',
  time: '',
  interviewer: '',
  type: '初面',
  note: ''
})

const dialogTitle = computed(() => {
  return props.interview ? '编辑面试安排' : '安排面试'
})

const candidateName = computed(() => {
  return props.interview?.candidateName ?? props.candidate?.name ?? ''
})

const positionName = computed(() => {
  return props.interview?.position ?? props.candidate?.position ?? ''
})

const rules: FormRules<InterviewForm> = {
  date: [
    {
      required: true,
      message: '请选择面试日期',
      trigger: 'change'
    }
  ],

  time: [
    {
      required: true,
      message: '请选择面试时间',
      trigger: 'change'
    }
  ],

  interviewer: [
    {
      required: true,
      message: '请输入面试官',
      trigger: 'blur'
    }
  ],

  type: [
    {
      required: true,
      message: '请选择面试轮次',
      trigger: 'change'
    }
  ]
}

const resetForm = () => {
  Object.assign(formData, {
    date: '',
    time: '',
    interviewer: '',
    type: '初面',
    note: ''
  })
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (!visible) {
      return
    }

    if (props.interview) {
      Object.assign(formData, {
        date: props.interview.date,

        time: props.interview.time,

        interviewer: props.interview.interviewer,

        type: props.interview.type,

        note: props.interview.note
      })
    } else {
      resetForm()
    }

    await nextTick()

    formRef.value?.clearValidate()
  }
)

const handleClose = () => {
  if (props.submitting) {
    return
  }

  emit('update:modelValue', false)
}

const handleSubmit = async () => {
  if (!formRef.value || props.submitting) {
    return
  }

  const candidateId = props.interview?.candidateId ?? props.candidate?.id

  if (!candidateId) {
    return
  }

  const valid = await formRef.value.validate().catch(() => false)

  if (!valid) {
    return
  }

  emit('submit', {
    candidateId,

    candidateName: candidateName.value,

    position: positionName.value,

    date: formData.date,

    time: formData.time,

    interviewer: formData.interviewer,

    type: formData.type,

    note: formData.note
  })
}
</script>
