export interface UserProfile {
  name: string
  username: string
  role: string
  department: string
  email: string
  phone: string
}

export interface ProfileFormData {
  name: string
  department: string
  email: string
  phone: string
}

export interface PasswordFormData {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}
