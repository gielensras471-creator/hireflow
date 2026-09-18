import request from '@/api/request'

import type { PasswordFormData, ProfileFormData, UserProfile } from '@/types/profile'

export const getProfileApi = () => {
  return request.get<UserProfile>('/profile')
}

export const updateProfileApi = (data: ProfileFormData) => {
  return request.patch<UserProfile>('/profile', data)
}

export const changePasswordApi = (data: Pick<PasswordFormData, 'currentPassword' | 'newPassword'>) => {
  return request.patch<{ message: string }>('/profile/password', data)
}
