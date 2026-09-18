import { verifyAccessToken } from '../utils/jwt.js'

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: '请先登录' })
  }

  try {
    const payload = verifyAccessToken(token)
    req.user = {
      id: Number(payload.sub),
      username: payload.username,
      role: payload.role
    }
    next()
  } catch {
    return res.status(401).json({ message: '登录状态已失效，请重新登录' })
  }
}
