import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { Interview, InterviewFormData, InterviewStatus } from '@/types/interview'

export const useInterviewStore = defineStore('interview', () => {
  const interviews = ref<Interview[]>([
    {
      id: 1,
      candidateId: 1,
      candidateName: '陈晓',
      position: '前端开发工程师',
      date: '2026-09-14',
      time: '10:00',
      interviewer: '张经理',
      type: '初面',
      note: '重点了解 Vue3 和项目经历',
      status: 'scheduled'
    }
  ])

  const addInterview = (data: InterviewFormData) => {
    const hasScheduledInterview = interviews.value.some(
      (item) => item.candidateId === data.candidateId && item.status === 'scheduled'
    )

    if (hasScheduledInterview) {
      return false
    }

    interviews.value.unshift({
      id: Date.now(),
      ...data,
      status: 'scheduled'
    })

    return true
  }

  const updateInterviewStatus = (id: number, status: InterviewStatus) => {
    const target = interviews.value.find((item) => item.id === id)

    if (target) {
      target.status = status
    }
  }
  const updateInterview = (id: number, data: InterviewFormData) => {
    const target = interviews.value.find((item) => item.id === id)

    if (!target) {
      return false
    }

    Object.assign(target, data)

    return {
      interviews,
      addInterview,
      updateInterview,
      updateInterviewStatus,
      removeInterview
    }
  }
  const removeInterview = (id: number) => {
    interviews.value = interviews.value.filter((item) => item.id !== id)
  }

  return {
    interviews,
    addInterview,
    updateInterview,
    updateInterviewStatus,
    removeInterview
  }
})
