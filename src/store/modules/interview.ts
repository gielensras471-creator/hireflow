import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Interview, InterviewFormData } from '@/types/interview'

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
    interviews.value.unshift({
      id: Date.now(),
      ...data,
      status: 'scheduled'
    })
  }

  return {
    interviews,
    addInterview
  }
})
