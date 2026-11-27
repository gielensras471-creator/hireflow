import { createHmac } from 'node:crypto'
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { CommandError } from '../services/command-core.js'
import { requireRecruitingActor } from '../services/recruiting-auth.js'
import { V3HttpError } from './error-v3.js'

const issuer = 'hireflow-v3'
const audience = 'hireflow-v3-api'
const algorithm = 'HS256'
const passwordCost = 12
const passwordWindowMs = 60_000
const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role
})

function accountBody(req, keys) {
  if (!req.is('application/json')) throw new V3HttpError('UNSUPPORTED_MEDIA_TYPE')
  const body = req.body
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(body, key) || typeof body[key] !== 'string')
  )
    throw new V3HttpError('INVALID_REQUEST')
  return body
}

export const createV3Auth = ({ db, jwtSecret, accountWrites = false }) => {
  if (typeof jwtSecret !== 'string' || !jwtSecret.trim() || Buffer.byteLength(jwtSecret) < 32)
    throw new TypeError('An explicit V3 JWT secret of at least 32 bytes is required')

  // Domain separation also prevents a V2 verifier with the same input secret accepting V3 tokens.
  const key = createHmac('sha256', jwtSecret).update('hireflow:v3:access-token').digest()
  const subjects = new WeakMap()
  const userById = db.prepare('SELECT id,username,name,role,auth_version FROM users WHERE id=?')
  const resolveActor = (context) => {
    const subject = subjects.get(context)
    if (subject && userById.get(subject.id)?.auth_version === subject.version) return subject.id
  }
  const userByName = db.prepare(
    'SELECT id,username,name,role,password_hash,auth_version FROM users WHERE username=?'
  )
  const credentialsById = db.prepare('SELECT password_hash,auth_version FROM users WHERE id=?')
  const changeName = db.prepare(
    "UPDATE users SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND auth_version=? AND role IN ('招聘管理员','hr','admin')"
  )
  const rotateCredentials = db.prepare(`
    UPDATE users SET password_hash=?, auth_version=auth_version+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND auth_version=? AND password_hash=? AND role IN ('招聘管理员','hr','admin')
      AND auth_version<9007199254740991
  `)
  const passwordAttempts = new Map()
  let passwordWindow = Date.now()
  let hashing = 0

  const requireAuth = (req, res, next) => {
    const authorization = req.get('Authorization')
    if (!authorization) return next(new V3HttpError('AUTH_REQUIRED'))
    const bearer = /^Bearer ([^\s]+)$/i.exec(authorization)
    if (!bearer) return next(new V3HttpError('INVALID_TOKEN'))

    let claims
    try {
      claims = jwt.verify(bearer[1], key, { algorithms: [algorithm], issuer, audience })
    } catch {
      return next(new V3HttpError('INVALID_TOKEN'))
    }
    if (
      typeof claims?.sub !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sub) ||
      !Number.isSafeInteger(Number(claims.sub)) ||
      !Number.isSafeInteger(claims.exp) ||
      typeof claims.username !== 'string' ||
      !Number.isSafeInteger(claims.authVersion) ||
      claims.authVersion < 1
    )
      return next(new V3HttpError('INVALID_TOKEN'))
    const user = userById.get(Number(claims.sub))
    if (
      !user?.name.trim() ||
      user.username !== claims.username ||
      user.auth_version !== claims.authVersion
    )
      return next(new V3HttpError('INVALID_TOKEN'))
    const context = Object.freeze({})
    subjects.set(context, { id: user.id, version: user.auth_version })
    res.locals.v3ActorContext = context
    res.locals.v3User = publicUser(user)
    next()
  }

  const requireRecruiting = (_req, res, next) => {
    try {
      requireRecruitingActor(db, resolveActor, res.locals.v3ActorContext)
    } catch (error) {
      if (error instanceof CommandError && error.code === 'FORBIDDEN')
        return next(new V3HttpError('FORBIDDEN'))
      if (error instanceof CommandError && error.code === 'INVALID_ACTOR')
        return next(new V3HttpError('AUTH_REQUIRED'))
      return next(error)
    }
    next()
  }

  const router = Router()
  router.post('/login', (req, res) => {
    if (!req.is('application/json')) throw new V3HttpError('UNSUPPORTED_MEDIA_TYPE')
    const body = req.body
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((field) => !['username', 'password', 'remember'].includes(field)) ||
      typeof body.username !== 'string' ||
      !body.username.trim() ||
      body.username.length > 128 ||
      typeof body.password !== 'string' ||
      !body.password ||
      Buffer.byteLength(body.password) > 72 ||
      (Object.hasOwn(body, 'remember') && typeof body.remember !== 'boolean')
    )
      throw new V3HttpError('INVALID_REQUEST')
    const user = userByName.get(body.username.trim())
    if (!user?.name.trim() || !bcrypt.compareSync(body.password, user.password_hash))
      throw new V3HttpError('INVALID_CREDENTIALS')
    const expiresIn = body.remember ? 7 * 86400 : 12 * 3600
    const token = jwt.sign({ username: user.username, authVersion: user.auth_version }, key, {
      algorithm,
      issuer,
      audience,
      subject: String(user.id),
      expiresIn
    })
    res.json({ token, expiresAt: jwt.decode(token).exp * 1000, user: publicUser(user) })
  })
  router.get('/me', requireAuth, (_req, res) => res.json(res.locals.v3User))
  const requireAccountWrites = (_req, _res, next) =>
    next(accountWrites === true ? undefined : new V3HttpError('ACCOUNT_WRITE_DISABLED'))

  router.patch('/me', requireAuth, requireAccountWrites, requireRecruiting, (req, res) => {
    const raw = accountBody(req, ['name']).name
    const name = raw.trim()
    if (!raw.isWellFormed() || /[\p{Cc}\p{Cf}]/u.test(raw) || !name || [...name].length > 64)
      throw new V3HttpError('INVALID_DISPLAY_NAME')
    const { id, version } = subjects.get(res.locals.v3ActorContext)
    if (!changeName.run(name, id, version).changes) throw new V3HttpError('ACCOUNT_CHANGED')
    res.json(publicUser(userById.get(id)))
  })

  router.patch(
    '/me/password',
    requireAuth,
    requireAccountWrites,
    requireRecruiting,
    async (req, res, next) => {
      try {
        const { currentPassword, newPassword } = accountBody(req, [
          'currentPassword',
          'newPassword'
        ])
        if (
          !currentPassword ||
          Buffer.byteLength(currentPassword) > 72 ||
          !currentPassword.isWellFormed()
        )
          throw new V3HttpError('CURRENT_PASSWORD_INVALID')
        if (
          !newPassword.isWellFormed() ||
          [...newPassword].length < 12 ||
          Buffer.byteLength(newPassword) > 72 ||
          !newPassword.trim() ||
          /\p{Cc}/u.test(newPassword)
        )
          throw new V3HttpError('INVALID_NEW_PASSWORD')
        const { id, version } = subjects.get(res.locals.v3ActorContext)
        const entry = credentialsById.get(id)
        if (entry?.auth_version !== version) throw new V3HttpError('ACCOUNT_CHANGED')

        // Bound costly verification per authenticated account and concurrent work per process.
        const now = Date.now()
        if (now - passwordWindow >= passwordWindowMs) {
          passwordWindow = now
          passwordAttempts.clear()
        }
        const count = passwordAttempts.get(id) ?? 0
        if (count >= 5 || (!count && passwordAttempts.size >= 4096)) {
          res.set(
            'Retry-After',
            String(Math.max(1, Math.ceil((passwordWindow + passwordWindowMs - now) / 1000)))
          )
          throw new V3HttpError('PASSWORD_RATE_LIMIT')
        }
        if (hashing >= 4) throw new V3HttpError('COMMAND_BUSY')
        passwordAttempts.set(id, count + 1)
        hashing++
        try {
          if (!(await bcrypt.compare(currentPassword, entry.password_hash)))
            throw new V3HttpError('CURRENT_PASSWORD_INVALID')
          if (
            newPassword === currentPassword ||
            (await bcrypt.compare(newPassword, entry.password_hash))
          )
            throw new V3HttpError('PASSWORD_UNCHANGED')
          const hash = await bcrypt.hash(newPassword, passwordCost)
          if (!rotateCredentials.run(hash, id, version, entry.password_hash).changes)
            throw new V3HttpError('ACCOUNT_CHANGED')
          res.status(204).end()
        } finally {
          hashing--
        }
      } catch (error) {
        next(error)
      }
    }
  )

  return Object.freeze({ router, requireAuth, requireRecruiting, resolveActor })
}
