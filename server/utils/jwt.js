import jwt from 'jsonwebtoken'

export const createTokenService = (jwtSecret) => {
  if (typeof jwtSecret !== 'string' || !jwtSecret)
    throw new TypeError('An explicit JWT secret is required')
  const signAccessToken = (user, remember = false) => {
    const expiresIn = remember ? '7d' : '12h'
    const expiresMs = remember ? 7 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000

    return {
      token: jwt.sign(
        {
          sub: String(user.id),
          username: user.username,
          role: user.role
        },
        jwtSecret,
        { expiresIn }
      ),
      expiresAt: Date.now() + expiresMs
    }
  }

  const verifyAccessToken = (token) => jwt.verify(token, jwtSecret)

  return { signAccessToken, verifyAccessToken }
}
