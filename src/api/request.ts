import axios from 'axios'

import type { AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'

const service = axios.create({
  baseURL: import.meta.env.VITE_HIREFLOW_API_URL || 'http://localhost:3300',
  timeout: 10000
})

service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('hireflow_token')

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

service.interceptors.response.use(
  (response) => response,
  (error) => {
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
