import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createInterviewApi,
  deleteInterviewApi,
  getInterviewListApi,
  updateInterviewApi,
  updateInterviewStatusApi
} from '@/api/modules/interview'

import type { Interview, InterviewFormData, InterviewStatus } from '@/types/interview'

export const useInterviewStore = defineStore('interview', () => {
  const interviews = ref<Interview[]>([])

  const loading = ref(false)

  const error = ref(false)

  const loaded = ref(false)

  const sortInterviews = (list: Interview[]) => {
    return [...list].sort((a, b) => {
      const dateResult = b.date.localeCompare(a.date)

      if (dateResult !== 0) {
        return dateResult
      }

      return b.time.localeCompare(a.time)
    })
  }

  const fetchInterviews = async (force = false) => {
    if (loaded.value && !force) {
      return interviews.value
    }

    loading.value = true
    error.value = false

    try {
      const data = await getInterviewListApi()

      interviews.value = sortInterviews(data)

      loaded.value = true

      return interviews.value
    } catch (err) {
      error.value = true

      throw err
    } finally {
      loading.value = false
    }
  }

  const hasScheduledInterview = (candidateId: number) => {
    return interviews.value.some(
      (item) => item.candidateId === candidateId && item.status === 'scheduled'
    )
  }

  const addInterview = async (data: InterviewFormData) => {
    /*
     * Candidate 页面可能在用户尚未进入
     * Interview 页面时创建面试。
     *
     * 所以这里先保证 Store 已获取后端数据，
     * 否则无法可靠判断重复待面试记录。
     */
    if (!loaded.value) {
      await fetchInterviews()
    }

    if (hasScheduledInterview(data.candidateId)) {
      return null
    }

    const created = await createInterviewApi({
      ...data,
      status: 'scheduled'
    })

    interviews.value.unshift(created)

    return created
  }

  const updateInterview = async (id: number, data: InterviewFormData) => {
    const updated = await updateInterviewApi(id, data)

    const index = interviews.value.findIndex((item) => item.id === id)

    if (index !== -1) {
      interviews.value[index] = updated
    }

    return updated
  }

  const updateInterviewStatus = async (id: number, status: InterviewStatus) => {
    const updated = await updateInterviewStatusApi(id, status)

    const index = interviews.value.findIndex((item) => item.id === id)

    if (index !== -1) {
      interviews.value[index] = updated
    }

    return updated
  }

  const removeInterview = async (id: number) => {
    await deleteInterviewApi(id)

    interviews.value = interviews.value.filter((item) => item.id !== id)
  }

  return {
    interviews,
    loading,
    error,
    loaded,

    fetchInterviews,
    hasScheduledInterview,
    addInterview,
    updateInterview,
    updateInterviewStatus,
    removeInterview
  }
})
