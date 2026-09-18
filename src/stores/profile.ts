import { defineStore } from 'pinia'
import { ref } from 'vue'

import { changePasswordApi, getProfileApi, updateProfileApi } from '@/api/modules/profile'
import type { PasswordFormData, ProfileFormData, UserProfile } from '@/types/profile'

const emptyProfile = (): UserProfile => ({
  id: 0,
  name: 'HireFlow 用户',
  username: 'admin',
  role: '招聘管理员',
  department: '人力资源部',
  email: '',
  phone: ''
})

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<UserProfile>(emptyProfile())
  const loading = ref(false)
  const loaded = ref(false)

  const fetchProfile = async (force = false) => {
    if (loaded.value && !force) return profile.value

    loading.value = true

    try {
      profile.value = await getProfileApi()
      loaded.value = true
      return profile.value
    } finally {
      loading.value = false
    }
  }

  const updateProfile = async (data: ProfileFormData) => {
    profile.value = await updateProfileApi(data)
    loaded.value = true
    return profile.value
  }

  const changePassword = async (data: PasswordFormData) => {
    return changePasswordApi({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword
    })
  }

  const reset = () => {
    profile.value = emptyProfile()
    loaded.value = false
  }

  return {
    profile,
    loading,
    loaded,
    fetchProfile,
    updateProfile,
    changePassword,
    reset
  }
})
