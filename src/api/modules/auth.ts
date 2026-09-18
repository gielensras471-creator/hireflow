import request from '@/api/request'

import type { UserProfile } from '@/types/profile'

export interface LoginPayload {
  username: string
  password: string
  remember: boolean
}

export interface LoginResponse {
  token: string
  expiresAt: number
  user: UserProfile
}

export const loginApi = (data: LoginPayload) => {
  return request.post<LoginResponse>('/auth/login', data)
}

export const getCurrentUserApi = () => {
  return request.get<UserProfile>('/auth/me')
}
