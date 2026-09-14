import request from '@/api/request'

import type { Position, PositionFormData } from '@/types/position'

export interface CreatePositionPayload extends PositionFormData {
  candidateCount: number
  publishDate: string
}

export const getPositionListApi = () => {
  return request.get<Position[]>('/positions')
}

export const createPositionApi = (data: CreatePositionPayload) => {
  return request.post<Position>('/positions', data)
}

export const updatePositionApi = (id: number, data: Partial<Position>) => {
  return request.patch<Position>(`/positions/${id}`, data)
}

export const deletePositionApi = (id: number) => {
  return request.delete(`/positions/${id}`)
}
