import { randomUUID } from 'node:crypto'
import { CommandError } from '../services/command-core.js'

const publicErrors = Object.freeze({
  INVALID_QUERY: [400, '筛选或分页参数无效'],
  INVALID_ID: [400, '资源编号无效'],
  INVALID_VERSION: [400, '缺少有效的资源版本'],
  INVALID_IDEMPOTENCY_KEY: [400, '缺少有效的幂等键'],
  INVALID_ACTOR: [401, '登录状态无效或已失效'],
  AGGREGATE_NOT_FOUND: [404, '记录不存在'],
  POSITION_NOT_OPEN: [409, '该职位当前不可投递'],
  POSITION_DELETED: [409, '该职位已归档'],
  APPLICATION_CLOSED: [409, '该申请已关闭'],
  VERSION_CONFLICT: [409, '记录已有新进展，请刷新后重试'],
  IDEMPOTENCY_CONFLICT: [409, '该幂等键已用于不同的请求'],
  NO_CHANGE: [409, '没有可保存的变更'],
  INVALID_FIELDS: [422, '包含不允许的字段'],
  MISSING_FIELD: [422, '缺少必填字段'],
  INVALID_FIELD_TYPE: [422, '字段类型无效'],
  EMPTY_FIELD: [422, '必填资料不能为空'],
  INVALID_DATE: [422, '日期无效'],
  INVALID_EMAIL: [422, '邮箱格式无效'],
  INVALID_STATUS: [422, '职位状态无效'],
  COMMAND_BUSY: [503, '系统暂忙，请稍后重试'],
  INVALID_REQUEST: [400, '请求格式无效'],
  AUTH_REQUIRED: [401, '请先登录'],
  INVALID_CREDENTIALS: [401, '账号或密码错误'],
  INVALID_TOKEN: [401, '登录状态无效或已失效'],
  FORBIDDEN: [403, '当前账号没有操作权限'],
  NOT_FOUND: [404, '接口不存在'],
  PAYLOAD_TOO_LARGE: [413, '请求体过大'],
  UNSUPPORTED_MEDIA_TYPE: [415, '不支持的请求格式'],
  INTERNAL_ERROR: [500, '服务器内部错误']
})

export class V3HttpError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

export const v3RequestContext = (_req, res, next) => {
  res.locals.requestId = randomUUID()
  res.set('X-Request-Id', res.locals.requestId)
  res.set('Cache-Control', 'no-store')
  next()
}

export const v3NotFound = (_req, _res, next) => next(new V3HttpError('NOT_FOUND'))

export const v3ErrorHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error)
  let code = 'INTERNAL_ERROR'
  if (
    (error instanceof V3HttpError || error instanceof CommandError) &&
    Object.hasOwn(publicErrors, error.code)
  )
    code = error.code
  else if (error.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 0xff))
    code = 'COMMAND_BUSY'
  else if (['entity.parse.failed', 'request.size.invalid', 'request.aborted'].includes(error.type))
    code = 'INVALID_REQUEST'
  else if (error instanceof URIError && error.status === 400) code = 'INVALID_REQUEST'
  else if (error.type === 'entity.too.large') code = 'PAYLOAD_TOO_LARGE'
  else if (['charset.unsupported', 'encoding.unsupported'].includes(error.type))
    code = 'UNSUPPORTED_MEDIA_TYPE'
  const [status, message] = publicErrors[code]
  if (status === 503) res.set('Retry-After', '1')
  if (status === 401) res.set('WWW-Authenticate', 'Bearer')
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } })
}
