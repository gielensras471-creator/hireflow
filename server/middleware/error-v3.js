import { randomUUID } from 'node:crypto'
import { CommandError } from '../services/command-core.js'

const publicErrors = Object.freeze({
  NO_NEXT_STAGE: [409, '当前申请没有下一招聘阶段'],
  SCHEDULED_INTERVIEW_PENDING: [409, '请先处理待进行的面试'],
  INVALID_APPLICATION_STATE: [409, '当前申请状态不允许此操作'],
  INVALID_OFFER_STAGE: [409, '当前阶段不能操作 Offer'],
  INVALID_OFFER_STATUS: [409, '当前 Offer 状态不允许此操作'],
  ADVANCEMENT_REASON_REQUIRED: [422, '本次晋级须填写理由'],
  INVALID_REASON: [422, '理由格式无效'],
  INVALID_STAGE_TRANSITION: [422, '只能推进到下一个招聘阶段'],
  INVALID_CLOSURE_OUTCOME: [422, '关闭结果无效'],
  CLOSURE_REASON_REQUIRED: [422, '须填写非空的结束理由'],
  INVALID_INTERVIEW: [400, '面试编号无效'],
  INVALID_INTERVIEW_VERSION: [400, '缺少有效的面试版本'],
  INVALID_FEEDBACK_REVISION: [400, '缺少有效的面评版本'],
  INTERVIEW_NOT_FOUND: [404, '面试记录不存在'],
  INTERVIEW_ASSOCIATION_CONFLICT: [404, '面试记录不存在'],
  FEEDBACK_NOT_FOUND: [404, '面评记录不存在'],
  INVALID_INTERVIEW_STAGE: [409, '当前申请阶段不能安排面试'],
  INTERVIEW_ALREADY_SCHEDULED: [409, '该申请已有待进行的面试'],
  INTERVIEW_VERSION_CONFLICT: [409, '面试已有新进展，请刷新后重试'],
  INTERVIEW_NOT_SCHEDULED: [409, '面试已不处于预约状态'],
  INTERVIEW_NOT_COMPLETED: [409, '面试尚未完成'],
  FEEDBACK_ALREADY_EXISTS: [409, '该面试已有有效面评'],
  FEEDBACK_REVISION_CONFLICT: [409, '面评已有新进展，请刷新后重试'],
  HISTORICAL_FEEDBACK_NOT_ALLOWED: [409, '旧轮面评需走历史补录'],
  NOT_PAST_INTERVIEW_ROUND: [409, '只有已结束轮次可以补录'],
  HISTORICAL_WAIVER_REQUIRED: [409, '缺少有效的晋级豁免记录'],
  INVALID_TIME: [422, '面试预约时间无效'],
  INVALID_FEEDBACK: [422, '评价人或评价理由无效'],
  INVALID_RECOMMENDATION: [422, '评价结论无效'],
  CANCEL_REASON_REQUIRED: [422, '取消面试须填写理由'],
  CORRECTION_REASON_REQUIRED: [422, '更正面评须填写理由'],
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
