import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createCandidateApi,
  deleteCandidateApi,
  getCandidateDetailApi,
  getCandidateListApi,
  updateCandidateApi,
  updateCandidateStageApi
} from '@/api/modules/candidate'

import type { Candidate, CandidateFormData, CandidateStage } from '@/types/candidate'

export const useCandidateStore = defineStore('candidate', () => {
  const candidates = ref<Candidate[]>([])

  const loading = ref(false)

  const error = ref(false)

  const loaded = ref(false)

  const getCandidateById = (id: number) => {
    return candidates.value.find((item) => item.id === id)
  }

  const fetchCandidates = async (force = false) => {
    if (loaded.value && !force) {
      return candidates.value
    }

    loading.value = true
    error.value = false

    try {
      const data = await getCandidateListApi()

      candidates.value = [...data].sort((a, b) => b.appliedDate.localeCompare(a.appliedDate))

      loaded.value = true

      return candidates.value
    } catch (err) {
      error.value = true

      throw err
    } finally {
      loading.value = false
    }
  }

  const fetchCandidateById = async (id: number) => {
    const existing = getCandidateById(id)

    if (existing) {
      return existing
    }

    const candidate = await getCandidateDetailApi(id)

    candidates.value.push(candidate)

    return candidate
  }

  const addCandidate = async (data: CandidateFormData, appliedDate: string) => {
    const created = await createCandidateApi({
      ...data,
      appliedDate
    })

    candidates.value.unshift(created)

    return created
  }

  const updateCandidate = async (id: number, data: Partial<Candidate>) => {
    const updated = await updateCandidateApi(id, data)

    const index = candidates.value.findIndex((item) => item.id === id)

    if (index !== -1) {
      candidates.value[index] = updated
    }

    return updated
  }

  const updateCandidateStage = async (id: number, stage: CandidateStage) => {
    const updated = await updateCandidateStageApi(id, stage)

    const index = candidates.value.findIndex((item) => item.id === id)

    if (index !== -1) {
      candidates.value[index] = updated
    }

    return updated
  }

  const removeCandidate = async (id: number) => {
    await deleteCandidateApi(id)

    candidates.value = candidates.value.filter((item) => item.id !== id)
  }

  return {
    candidates,
    loading,
    error,
    loaded,

    getCandidateById,
    fetchCandidates,
    fetchCandidateById,
    addCandidate,
    updateCandidate,
    updateCandidateStage,
    removeCandidate
  }
})
