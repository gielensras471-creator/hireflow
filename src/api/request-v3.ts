import axios from 'axios'
import { createV3Session, V3Error, type Credentials, type V3User } from '../utils/auth-v3'

const http = axios.create({ baseURL: '/api/v3', timeout: 10000 })

export function adaptV3Error(error: unknown): V3Error {
  if (error instanceof V3Error) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0
    const problem = error.response?.data?.error
    const code = typeof problem?.code === 'string' ? problem.code : 'REQUEST_FAILED'
    const requestId = typeof problem?.requestId === 'string' ? problem.requestId : undefined
    const message =
      status === 401
        ? '登录失效或账号密码有误，请重新登录。'
        : status === 403
          ? '当前账号没有招聘权限。'
          : status === 409
            ? '记录已有新进展，请刷新后重新确认。'
            : status === 422 || status === 400
              ? '请检查填写内容。'
              : '服务暂不可用，请稍后重试。'
    return new V3Error(status, code, message, requestId)
  }
  return new V3Error(0, 'REQUEST_FAILED', '服务暂不可用，请稍后重试。')
}

const transport = {
  async login(credentials: Credentials) {
    try {
      const { data } = await http.post<{ token: string; expiresAt: number }>(
        '/auth/login',
        credentials
      )
      return { token: data.token, expiresAt: data.expiresAt }
    } catch (error) {
      throw adaptV3Error(error)
    }
  },
  async me(token: string) {
    try {
      return (await http.get<V3User>('/auth/me', { headers: { Authorization: 'Bearer ' + token } }))
        .data
    } catch (error) {
      throw adaptV3Error(error)
    }
  }
}

export const v3Session = createV3Session(transport, window.localStorage, window.sessionStorage)

type WriteOptions = { idempotencyKey: string } & (
  | { operation: 'create'; expectedVersion?: never }
  | { operation: 'update'; expectedVersion: number }
)

async function authorized<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  data?: object,
  idempotencyKey?: string
): Promise<T> {
  // Keep credentials inside this API namespace, including after URL normalization.
  if (!/^\/(?!\/)[a-zA-Z0-9_/-]+(?:\?[^#]*)?$/.test(path)) {
    throw new TypeError('Expected an API-relative path')
  }
  const token = v3Session.token()
  const version = v3Session.version()
  if (!token || v3Session.state.status !== 'ready')
    throw new V3Error(401, 'AUTH_REQUIRED', '请重新登录。')
  try {
    const result = await http.request<T>({
      method,
      url: path,
      data,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      }
    })
    if (v3Session.version() === version && v3Session.state.status === 'unavailable')
      throw new V3Error(0, 'IDENTITY_UNAVAILABLE', '连接暂时中断，请重试。')
    if (
      v3Session.version() !== version ||
      v3Session.token() !== token ||
      v3Session.state.status !== 'ready'
    )
      throw new V3Error(401, 'AUTH_REQUIRED', '请重新登录。')
    return result.data
  } catch (error) {
    const problem = error instanceof V3Error ? error : adaptV3Error(error)
    if (problem.status === 401) v3Session.reject(token, 401, version)
    if (problem.status === 403 && v3Session.version() === version) await v3Session.refresh()
    throw problem
  }
}

export const readV3 = <T>(path: string) => authorized<T>('GET', path)

export function writeV3<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: Record<string, unknown>,
  options: WriteOptions
) {
  if (
    !options.idempotencyKey.trim() ||
    Object.prototype.hasOwnProperty.call(body, 'expectedVersion')
  ) {
    throw new TypeError('Write metadata must be supplied separately')
  }
  if (
    options.operation === 'update' &&
    (!Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 1)
  ) {
    throw new TypeError('A positive expectedVersion is required')
  }
  return authorized<T>(
    method,
    path,
    options.operation === 'create' ? body : { ...body, expectedVersion: options.expectedVersion },
    options.idempotencyKey
  )
}
