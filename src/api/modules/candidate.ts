import request from '@/api/request'

import type { Candidate, CandidateFormData, CandidateStage } from '@/types/candidate'

export interface CreateCandidatePayload extends CandidateFormData {
  appliedDate: string
}

export const getCandidateListApi = () => {
  return request.get<Candidate[]>('/candidates')
}

export const getCandidateDetailApi = (id: number) => {
  return request.get<Candidate>(`/candidates/${id}`)
}

export const createCandidateApi = (data: CreateCandidatePayload) => {
  return request.post<Candidate>('/candidates', data)
}

export const updateCandidateApi = (id: number, data: Partial<Candidate>) => {
  return request.patch<Candidate>(`/candidates/${id}`, data)
}

export const updateCandidateStageApi = (id: number, stage: CandidateStage) => {
  return request.patch<Candidate>(`/candidates/${id}`, {
    stage
  })
}

export const deleteCandidateApi = (id: number) => {
  return request.delete(`/candidates/${id}`)
}
