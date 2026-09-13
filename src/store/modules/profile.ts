import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { UserProfile, ProfileFormData, PasswordFormData } from '@/types/profile'

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<UserProfile>({
    name: '招聘管理员',
    username: 'admin',
    role: '招聘管理员',
    department: '人力资源部',
    email: 'admin@hireflow.com',
    phone: '13800000000'
  })

  // Demo 密码
  const password = ref('123456')

  const updateProfile = (data: ProfileFormData) => {
    Object.assign(profile.value, data)
  }

  const changePassword = (data: PasswordFormData) => {
    if (data.currentPassword !== password.value) {
      return {
        success: false,
        message: '当前密码错误'
      }
    }

    if (data.newPassword === data.currentPassword) {
      return {
        success: false,
        message: '新密码不能与当前密码相同'
      }
    }

    password.value = data.newPassword

    return {
      success: true,
      message: '密码修改成功'
    }
  }

  return {
    profile,
    updateProfile,
    changePassword
  }
})
