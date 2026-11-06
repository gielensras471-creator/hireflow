import { randomUUID } from 'node:crypto'

const publicErrors = Object.freeze({
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
  if (error instanceof V3HttpError && Object.hasOwn(publicErrors, error.code)) code = error.code
  else if (['entity.parse.failed', 'request.size.invalid', 'request.aborted'].includes(error.type))
    code = 'INVALID_REQUEST'
  else if (error.type === 'entity.too.large') code = 'PAYLOAD_TOO_LARGE'
  else if (['charset.unsupported', 'encoding.unsupported'].includes(error.type))
    code = 'UNSUPPORTED_MEDIA_TYPE'
  const [status, message] = publicErrors[code]
  if (status === 401) res.set('WWW-Authenticate', 'Bearer')
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } })
}
