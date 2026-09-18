import jwt from 'jsonwebtoken'
import { serverConfig } from '../config.js'

export const signAccessToken = (user, remember = false) => {
  const expiresIn = remember ? '7d' : '12h'
  const expiresMs = remember ? 7 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000

  return {
    token: jwt.sign(
      {
        sub: String(user.id),
        username: user.username,
        role: user.role
      },
      serverConfig.jwtSecret,
      { expiresIn }
    ),
    expiresAt: Date.now() + expiresMs
  }
}

export const verifyAccessToken = (token) => jwt.verify(token, serverConfig.jwtSecret)
