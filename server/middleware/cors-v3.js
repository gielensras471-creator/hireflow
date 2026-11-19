export function validateV3Origins(origins) {
  if (!Array.isArray(origins)) throw new TypeError('Explicit V3 Origin list required')
  return [
    ...new Set(
      origins.map((origin) => {
        if (typeof origin !== 'string' || origin.trim() !== origin || /[\\%\s]/.test(origin))
          throw new TypeError('Invalid V3 Origin')
        const u = new URL(origin)
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
        if (
          (!local && u.protocol !== 'https:') ||
          (local && !['http:', 'https:'].includes(u.protocol)) ||
          origin !== u.origin ||
          u.username ||
          u.password ||
          origin.includes('*') ||
          u.hostname === 'null'
        )
          throw new TypeError('Invalid V3 Origin')
        return origin
      })
    )
  ]
}
export const parseV3Origins = (value) =>
  value === undefined || value === '' ? [] : validateV3Origins(value.split(','))
export function v3Cors(origins = []) {
  const allowed = new Set(validateV3Origins(origins))
  const methods = ['GET', 'POST', 'PATCH']
  const headers = ['content-type', 'authorization', 'idempotency-key']
  return (req, res, next) => {
    res.vary('Origin')
    const origin = req.get('Origin')
    const accepted = !!origin && allowed.has(origin)
    const preflight = req.method === 'OPTIONS' && !!req.get('Access-Control-Request-Method')
    if (preflight) {
      res.vary('Access-Control-Request-Method')
      res.vary('Access-Control-Request-Headers')
      const requested = (req.get('Access-Control-Request-Headers') ?? '')
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
      if (
        !accepted ||
        !methods.includes(req.get('Access-Control-Request-Method')) ||
        requested.some((x) => !headers.includes(x))
      )
        return res.status(403).json({
          error: {
            code: 'CORS_DENIED',
            message: 'Cross-origin request not permitted',
            requestId: res.locals.requestId
          }
        })
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Access-Control-Allow-Methods', methods.join(', '))
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key')
      return res.status(204).end()
    }
    if (accepted) res.set('Access-Control-Allow-Origin', origin)
    // No-Origin/same-origin compatibility; lack of CORS permission never supplies authentication.
    next()
  }
}
