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
    const businessMessages: Record<string, string> = {
      FEEDBACK_REVISION_CONFLICT: '面评已被更正，请核对最新内容与修订版本。',
      FEEDBACK_ALREADY_EXISTS: '该面试已有当前有效面评，请查看或有痕更正。',
      INTERVIEW_NOT_COMPLETED: '面试尚未完成，不能提交面评。',
      HISTORICAL_FEEDBACK_NOT_ALLOWED: '旧轮次请先核对历史补录资格。',
      HISTORICAL_WAIVER_REQUIRED: '没有真实晋级豁免证据，不能补录历史面评。',
      CORRECTION_REASON_REQUIRED: '更正面评必须填写原因。',
      INVALID_FEEDBACK: '请填写专业评价人和非空推荐依据。',
      INVALID_RECOMMENDATION: '请选择有效的推荐意见。',
      INTERVIEW_ALREADY_SCHEDULED: '该申请已有预约，请先完成或取消。',
      INVALID_INTERVIEW_STAGE: '当前申请阶段不能安排面试。',
      INTERVIEW_NOT_SCHEDULED: '面试已不处于预约状态，请刷新查看。',
      INTERVIEW_VERSION_CONFLICT: '面试已有新进展，请核对当前状态。',
      INVALID_TIME: '预约时间无效，请填写上海日期和时间。',
      CANCEL_REASON_REQUIRED: '取消面试必须填写原因。',
      NO_CHANGE: '内容没有变化，请修改后再提交。',
      POSITION_NOT_OPEN: '职位已关闭或归档，请重新选择开放职位。',
      POSITION_DELETED: '职位已归档，无法继续修改。',
      APPLICATION_CLOSED: '申请已结束，无法编辑普通资料。',
      IDEMPOTENCY_CONFLICT: '提交标识与内容不一致，请先核对原操作结果。'
    }
    const message =
      businessMessages[code] ??
      (status === 401
        ? '登录失效或账号密码有误，请重新登录。'
        : status === 403
          ? '当前账号没有招聘权限。'
          : status === 409
            ? '记录已有新进展，请刷新后重新确认。'
            : status === 422 || status === 400
              ? '请检查填写内容。'
              : '服务暂不可用，请稍后重试。')
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
    if (v3Session.version() === version && String(v3Session.state.status) === 'unavailable')
      throw new V3Error(0, 'IDENTITY_UNAVAILABLE', '连接暂时中断，请重试。')
    if (
      v3Session.version() !== version ||
      v3Session.token() !== token ||
      v3Session.state.status !== 'ready'
    )
      throw new V3Error(401, 'AUTH_REQUIRED', '请重新登录。')
    return result.data
  } catch (error) {
    let problem = error instanceof V3Error ? error : adaptV3Error(error)
    if (problem.status === 401) v3Session.reject(token, 401, version)
    if (problem.status === 403 && v3Session.version() === version) {
      await v3Session.refresh()
      if (v3Session.version() === version && v3Session.state.status === 'ready')
        problem = new V3Error(
          403,
          problem.code,
          '当前操作未获允许，登录状态仍有效。',
          problem.requestId
        )
    }
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
