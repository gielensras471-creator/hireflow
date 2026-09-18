import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncHandler, requireFields } from '../utils/http.js'
import { signAccessToken } from '../utils/jwt.js'

const router = Router()

const userSelect = `
  SELECT
    id,
    username,
    name,
    role,
    department,
    email,
    phone
  FROM users
  WHERE id = ?
`

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['username', 'password'])

    const username = String(req.body.username).trim()
    const password = String(req.body.password)
    const remember = Boolean(req.body.remember)

    const user = db
      .prepare(`
        SELECT id, username, password_hash AS passwordHash, name, role, department, email, phone
        FROM users
        WHERE username = ?
      `)
      .get(username)

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ message: '账号或密码错误' })
    }

    const { token, expiresAt } = signAccessToken(user, remember)
    const { passwordHash: _passwordHash, ...safeUser } = user

    res.json({
      token,
      expiresAt,
      user: safeUser
    })
  })
)

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare(userSelect).get(req.user.id)

  if (!user) {
    return res.status(404).json({ message: '用户不存在' })
  }

  res.json(user)
})

export default router
