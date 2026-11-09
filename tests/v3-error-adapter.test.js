import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Import the real browser API module in an isolated Node test process.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: storage, sessionStorage: storage }
})
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../utils/auth-v3' && context.parentURL?.endsWith('/src/api/request-v3.ts'))
      return nextResolve('../utils/auth-v3.ts', context)
    return nextResolve(specifier, context)
  }
})
let module
try {
  module = await import('../src/api/request-v3.ts')
} finally {
  hook.deregister()
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else delete globalThis.window
}
const { adaptV3Error, v3Session } = module

const cases = [
  [409, 'INTERVIEW_ALREADY_SCHEDULED', '该申请已有预约，请先完成或取消。'],
  [409, 'INTERVIEW_VERSION_CONFLICT', '面试已有新进展，请核对当前状态。'],
  [422, 'INVALID_TIME', '预约时间无效，请填写上海日期和时间。'],
  [422, 'CANCEL_REASON_REQUIRED', '取消面试必须填写原因。'],
  [409, 'NO_CHANGE', '内容没有变化，请修改后再提交。'],
  [409, 'POSITION_NOT_OPEN', '职位已关闭或归档，请重新选择开放职位。'],
  [409, 'APPLICATION_CLOSED', '申请已结束，无法编辑普通资料。'],
  [409, 'POSITION_DELETED', '职位已归档，无法继续修改。'],
  [409, 'IDEMPOTENCY_CONFLICT', '提交标识与内容不一致，请先核对原操作结果。'],
  [409, 'VERSION_CONFLICT', '记录已有新进展，请刷新后重新确认。'],
  [401, 'INVALID_TOKEN', '登录失效或账号密码有误，请重新登录。'],
  [403, 'FORBIDDEN', '当前账号没有招聘权限。'],
  [422, 'INVALID_FIELD', '请检查填写内容。'],
  [400, 'INVALID_REQUEST', '请检查填写内容。'],
  [503, 'BUSY', '服务暂不可用，请稍后重试。']
]
for (const [status, code, message] of cases) {
  test('adaptV3Error preserves business/fallback message and metadata: ' + code, () => {
    const before = JSON.stringify(v3Session.state)
    const error = adaptV3Error({
      isAxiosError: true,
      response: {
        status,
        data: { error: { code, message: 'internal fixture', requestId: 'fixture-request' } }
      }
    })
    assert.equal(error.message, message)
    assert.equal(error.status, status)
    assert.equal(error.code, code)
    assert.equal(error.requestId, 'fixture-request')
    if (status !== 401) assert.doesNotMatch(error.message, /登录失效/)
    assert.equal(JSON.stringify(v3Session.state), before)
    assert.equal(adaptV3Error(error), error)
  })
}
