import request from '@/api/request'

import type { Interview, InterviewFormData, InterviewStatus } from '@/types/interview'

export interface CreateInterviewPayload extends InterviewFormData {
  status: InterviewStatus
}

export const getInterviewListApi = () => {
  return request.get<Interview[]>('/interviews')
}

export const getInterviewDetailApi = (id: number) => {
  return request.get<Interview>(`/interviews/${id}`)
}

export const createInterviewApi = (data: CreateInterviewPayload) => {
  return request.post<Interview>('/interviews', data)
}

export const updateInterviewApi = (id: number, data: Partial<Interview>) => {
  return request.patch<Interview>(`/interviews/${id}`, data)
}

export const updateInterviewStatusApi = (id: number, status: InterviewStatus) => {
  return request.patch<Interview>(`/interviews/${id}`, {
    status
  })
}

export const deleteInterviewApi = (id: number) => {
  return request.delete(`/interviews/${id}`)
}
