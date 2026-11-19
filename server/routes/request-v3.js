import { V3HttpError } from '../middleware/error-v3.js'

export const fail = (code) => {
  throw new V3HttpError(code)
}
export const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail('INVALID_REQUEST')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('INVALID_REQUEST')
  return number
}

export const commandRequest = (req, command, fields, idParameter) => {
  if (!req.is('application/json')) fail('UNSUPPORTED_MEDIA_TYPE')
  const key = req.get('Idempotency-Key')
  if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key) || key.includes(','))
    fail('INVALID_IDEMPOTENCY_KEY')
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST')
  const entries = Object.entries(body)
  if (
    entries.some(
      ([field]) => !Object.hasOwn(fields, field) && !(idParameter && field === 'expectedVersion')
    )
  )
    fail('INVALID_FIELDS')
  const payload = Object.fromEntries(
    entries
      .filter(([field]) => field !== 'expectedVersion')
      .map(([field, value]) => [fields[field], value])
  )
  const request = { command, payload, idempotencyKey: key }
  if (idParameter) {
    request.aggregateId = integer(req.params[idParameter], 1)
    const version = body.expectedVersion
    if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)
      fail('INVALID_VERSION')
    request.expectedVersion = version
  }
  return request
}
