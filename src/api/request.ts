import axios from 'axios'

import type { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
import { clearSession, getSession } from '@/utils/auth'

const service = axios.create({
  baseURL: import.meta.env.VITE_HIREFLOW_API_URL || '/api',
  timeout: 10000
})

service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const session = getSession()

    if (session?.token) {
      config.headers.Authorization = `Bearer ${session.token}`
    }

    return config
  },
  (error) => Promise.reject(error)
)

service.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearSession()

      if (window.location.pathname !== '/login') {
        const redirect = `${window.location.pathname}${window.location.search}`
        window.location.assign(`/login?redirect=${encodeURIComponent(redirect)}`)
      }
    }

    return Promise.reject(error)
  }
)

const request = {
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await service.get<T>(url, config)
    return response.data
  },

  async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await service.post<T>(url, data, config)
    return response.data
  },

  async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await service.patch<T>(url, data, config)
    return response.data
  },

  async delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await service.delete<T>(url, config)
    return response.data
  }
}

export default request
