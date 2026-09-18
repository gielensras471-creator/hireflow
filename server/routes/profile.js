import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db } from '../db/database.js'
import { asyncHandler, requireFields } from '../utils/http.js'

const router = Router()

const getProfile = (id) =>
  db
    .prepare(`
      SELECT id, username, name, role, department, email, phone
      FROM users
      WHERE id = ?
    `)
    .get(id)

router.get('/', (req, res) => {
  const profile = getProfile(req.user.id)
  if (!profile) return res.status(404).json({ message: '用户不存在' })
  res.json(profile)
})

router.patch(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['name', 'department', 'email', 'phone'])

    const result = db
      .prepare(`
        UPDATE users
        SET name = ?, department = ?, email = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(
        String(req.body.name).trim(),
        String(req.body.department).trim(),
        String(req.body.email).trim(),
        String(req.body.phone).trim(),
        req.user.id
      )

    if (result.changes === 0) return res.status(404).json({ message: '用户不存在' })

    res.json(getProfile(req.user.id))
  })
)

router.patch(
  '/password',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['currentPassword', 'newPassword'])

    const currentPassword = String(req.body.currentPassword)
    const newPassword = String(req.body.newPassword)

    if (newPassword.length < 6) {
      return res.status(400).json({ message: '新密码至少需要 6 位' })
    }

    if (newPassword === currentPassword) {
      return res.status(400).json({ message: '新密码不能与当前密码相同' })
    }

    const user = db
      .prepare('SELECT id, password_hash AS passwordHash FROM users WHERE id = ?')
      .get(req.user.id)

    if (!user || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
      return res.status(400).json({ message: '当前密码错误' })
    }

    const passwordHash = bcrypt.hashSync(newPassword, 10)
    db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(passwordHash, req.user.id)

    res.json({ message: '密码修改成功' })
  })
)

export default router
