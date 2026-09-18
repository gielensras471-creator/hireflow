export const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export const requireFields = (body, fields) => {
  const missing = fields.filter((field) => {
    const value = body?.[field]
    return value === undefined || value === null || String(value).trim() === ''
  })

  if (missing.length > 0) {
    const error = new Error(`缺少必填字段：${missing.join(', ')}`)
    error.status = 400
    throw error
  }
}

export const parseId = (value) => {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('无效的资源 ID')
    error.status = 400
    throw error
  }
  return id
}
