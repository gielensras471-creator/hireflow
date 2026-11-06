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
const publicUser = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role
})

export const createV3Auth = ({ db, jwtSecret }) => {
  if (typeof jwtSecret !== 'string' || !jwtSecret.trim() || Buffer.byteLength(jwtSecret) < 32)
    throw new TypeError('An explicit V3 JWT secret of at least 32 bytes is required')

  // Domain separation also prevents a V2 verifier with the same input secret accepting V3 tokens.
  const key = createHmac('sha256', jwtSecret).update('hireflow:v3:access-token').digest()
  const subjects = new WeakMap()
  const resolveActor = (context) => subjects.get(context)
  const userById = db.prepare('SELECT id,username,name,role FROM users WHERE id=?')
  const userByName = db.prepare(
    'SELECT id,username,name,role,password_hash FROM users WHERE username=?'
  )

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
      typeof claims.username !== 'string'
    )
      return next(new V3HttpError('INVALID_TOKEN'))
    const user = userById.get(Number(claims.sub))
    if (!user?.name.trim() || user.username !== claims.username)
      return next(new V3HttpError('INVALID_TOKEN'))
    const context = Object.freeze({})
    subjects.set(context, user.id)
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
    const token = jwt.sign({ username: user.username }, key, {
      algorithm,
      issuer,
      audience,
      subject: String(user.id),
      expiresIn
    })
    res.json({ token, expiresAt: jwt.decode(token).exp * 1000, user: publicUser(user) })
  })
  router.get('/me', requireAuth, (_req, res) => res.json(res.locals.v3User))

  return Object.freeze({ router, requireAuth, requireRecruiting, resolveActor })
}
