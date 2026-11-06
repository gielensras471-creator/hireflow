import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createApp } from '../server/app.js'
import { createV3App } from '../server/app-v3.js'
import { createV3Schema } from '../server/db/schema-v3.js'
import { createV3Auth } from '../server/middleware/auth-v3.js'
import { v3ErrorHandler, v3RequestContext } from '../server/middleware/error-v3.js'
import { createTokenService } from '../server/utils/jwt.js'
import { createTestDatabase, openTestDatabase } from './helpers/test-db.js'

const password = 'fictional-http-test-password'

const prepare = (t) => {
  const db = openTestDatabase()
  t.after(() => db.close())
  createV3Schema(db)
  const insert = db.prepare(
    "INSERT INTO users(id,username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,'','','')"
  )
  const hash = bcrypt.hashSync(password, 4)
  insert.run(1, 'test-hr', hash, 'Test HR', '招聘管理员')
  insert.run(2, 'test-viewer', hash, 'Test Viewer', 'viewer')
  return { db, authConfig: { jwtSecret: randomBytes(32).toString('hex') } }
}

const listen = async (t, app) => {
  const server = app.listen(0, '127.0.0.1')
  t.after(
    () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  )
  await once(server, 'listening')
  return 'http://127.0.0.1:' + server.address().port
}

const login = (base, body = { username: 'test-hr', password }) =>
  fetch(base + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
const bearer = (token) => ({ headers: { Authorization: 'Bearer ' + token } })
const errorResponse = async (response, status, code) => {
  assert.equal(response.status, status)
  const json = await response.json()
  assert.deepEqual(Object.keys(json), ['error'])
  assert.deepEqual(Object.keys(json.error).sort(), ['code', 'message', 'requestId'])
  assert.equal(json.error.code, code)
  assert.ok(json.error.message)
  assert.match(json.error.requestId, /^[0-9a-f-]{36}$/)
  assert.equal(json.error.requestId, response.headers.get('x-request-id'))
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return json
}

test('E3-API-01 exposes minimal health and authenticates a real bcrypt V3 HR account', async (t) => {
  const base = await listen(t, createV3App(prepare(t)))
  const health = await fetch(base + '/api/v3/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  const response = await login(base)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const session = await response.json()
  assert.deepEqual(Object.keys(session).sort(), ['expiresAt', 'token', 'user'])
  assert.deepEqual(session.user, {
    id: 1,
    username: 'test-hr',
    name: 'Test HR',
    role: '招聘管理员'
  })
  assert.equal(session.expiresAt, jwt.decode(session.token).exp * 1000)
  const me = await fetch(base + '/api/v3/auth/me', bearer(session.token))
  assert.equal(me.status, 200)
  assert.deepEqual(await me.json(), session.user)
  await errorResponse(
    await login(base, { username: 'test-hr', password: 'wrong' }),
    401,
    'INVALID_CREDENTIALS'
  )
  await errorResponse(
    await login(base, { username: 'test-hr', password, role: 'admin' }),
    400,
    'INVALID_REQUEST'
  )
  await errorResponse(
    await fetch(base + '/api/v3/unknown-route', bearer(session.token)),
    404,
    'NOT_FOUND'
  )
})

test('E3-API-01 rejects missing, malformed, expired, wrong-domain and mismatched JWT subjects', async (t) => {
  const dependencies = prepare(t)
  const base = await listen(t, createV3App(dependencies))
  const me = base + '/api/v3/auth/me'
  await errorResponse(await fetch(me), 401, 'AUTH_REQUIRED')
  const secret = dependencies.authConfig.jwtSecret
  const key = createHmac('sha256', secret).update('hireflow:v3:access-token').digest()
  const options = { issuer: 'hireflow-v3', audience: 'hireflow-v3-api', subject: '1' }
  const sign = (overrides = {}, payload = { username: 'test-hr' }) =>
    jwt.sign(payload, key, { ...options, expiresIn: 60, ...overrides })
  for (const token of [
    'invalid',
    sign({ expiresIn: -60 }),
    sign({ algorithm: 'HS384' }),
    sign({ issuer: 'other' }),
    sign({ audience: 'other' }),
    sign({ subject: '01' }),
    sign({ subject: '99' }),
    sign({}, { username: 'test-viewer' }),
    jwt.sign({ username: 'test-hr' }, key, options),
    jwt.sign({ username: 'test-hr' }, randomBytes(32), { ...options, expiresIn: 60 })
  ]) {
    await errorResponse(await fetch(me, bearer(token)), 401, 'INVALID_TOKEN')
  }

  const { token } = await (await login(base)).json()
  dependencies.db.exec('DELETE FROM users WHERE id=1')
  await errorResponse(await fetch(me, bearer(token)), 401, 'INVALID_TOKEN')
})

test('E3-API-01 isolates V2 and V3 HTTP tokens even with the same input secret and user ID', async (t) => {
  const dependencies = prepare(t)
  const { jwtSecret } = dependencies.authConfig
  const v2db = createTestDatabase()
  t.after(() => v2db.close())
  const v2 = await listen(
    t,
    createApp({
      db: v2db,
      config: { jwtSecret, clientOrigins: [], isProduction: false }
    })
  )
  const v3 = await listen(t, createV3App(dependencies))
  const v2Token = createTokenService(jwtSecret).signAccessToken({
    id: 1,
    username: 'test-hr',
    role: 'admin'
  }).token
  assert.equal((await fetch(v2 + '/api/positions', bearer(v2Token))).status, 200)
  await errorResponse(await fetch(v3 + '/api/v3/auth/me', bearer(v2Token)), 401, 'INVALID_TOKEN')
  const { token } = await (await login(v3)).json()
  assert.equal((await fetch(v2 + '/api/positions', bearer(token))).status, 401)
})

test('E3-API-01 recruitment guard resolves a server-owned actor and rechecks roles after revocation', async (t) => {
  const { db, authConfig } = prepare(t)
  const auth = createV3Auth({ db, ...authConfig })
  const app = express()
  app.use(v3RequestContext)
  app.use(express.json())
  app.use('/api/v3/auth', auth.router)
  app.post('/test/recruiting', auth.requireAuth, auth.requireRecruiting, (req, res) => {
    assert.equal(auth.resolveActor(req.body), undefined)
    res.json({ actor: auth.resolveActor(res.locals.v3ActorContext) })
  })
  app.use(v3ErrorHandler)
  const base = await listen(t, app)
  const request = (token) =>
    fetch(base + '/test/recruiting', {
      method: 'POST',
      headers: { ...bearer(token).headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: 99, role: 'admin' })
    })
  const { token } = await (await login(base)).json()
  const viewer = await (await login(base, { username: 'test-viewer', password })).json()
  const allowed = await request(token)
  assert.equal(allowed.status, 200)
  assert.deepEqual(await allowed.json(), { actor: 1 })
  await errorResponse(await request(viewer.token), 403, 'FORBIDDEN')
  db.exec("UPDATE users SET role='viewer' WHERE id=1")
  await errorResponse(await request(token), 403, 'FORBIDDEN')
  const me = await fetch(base + '/api/v3/auth/me', bearer(token))
  assert.equal((await me.json()).role, 'viewer')
})

test('E3-API-01 rejects unsafe V3 configurations, changed schema and V2 connections at assembly', (t) => {
  const v2 = createTestDatabase()
  const untracked = new DatabaseSync(':memory:')
  t.after(() => {
    v2.close()
    untracked.close()
  })
  createV3Schema(untracked)
  const dependencies = prepare(t)
  const { db } = dependencies
  const reject = (candidate) =>
    assert.throws(() => createV3App({ ...dependencies, db: candidate }), /isolated V3/)
  reject(v2)
  reject(untracked)
  assert.throws(() => createV3App({ db }), /explicit V3 JWT/)
  for (const [disable, restore] of [
    ['PRAGMA foreign_keys=OFF', 'PRAGMA foreign_keys=ON'],
    ['PRAGMA recursive_triggers=OFF', 'PRAGMA recursive_triggers=ON'],
    ['PRAGMA ignore_check_constraints=ON', 'PRAGMA ignore_check_constraints=OFF'],
    ['PRAGMA query_only=ON', 'PRAGMA query_only=OFF'],
    ['BEGIN', 'ROLLBACK'],
    ["ATTACH DATABASE ':memory:' AS other", 'DETACH DATABASE other'],
    ['CREATE TEMP TABLE users (id INTEGER)', 'DROP TABLE temp.users']
  ]) {
    db.exec(disable)
    reject(db)
    db.exec(restore)
  }
  // Recent Node versions enable SQLite defensive mode, which ignores writable_schema=ON.
  if (typeof db.enableDefensive === 'function') db.enableDefensive(false)
  try {
    db.exec('PRAGMA writable_schema=ON')
    assert.equal(db.prepare('PRAGMA writable_schema').get().writable_schema, 1)
    reject(db)
  } finally {
    db.exec('PRAGMA writable_schema=OFF')
    if (typeof db.enableDefensive === 'function') db.enableDefensive(true)
  }
  assert.doesNotThrow(() => createV3App(dependencies))
  db.exec('DROP INDEX uq_interviews_one_scheduled')
  reject(db)
  assert.equal(
    db.prepare("SELECT 1 FROM sqlite_schema WHERE name='uq_interviews_one_scheduled'").get(),
    undefined
  )
})

test('E3-API-01 sanitizes malformed JSON, unsupported media, oversize and unexpected errors', async (t) => {
  const { db, authConfig } = prepare(t)
  const base = await listen(t, createV3App({ db, authConfig }))
  const body = (value, type = 'application/json') =>
    fetch(base + '/api/v3/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': type },
      body: value
    })
  const canary = 'sensitive-canary'
  const malformed = await errorResponse(
    await body('{"password":"' + canary),
    400,
    'INVALID_REQUEST'
  )
  assert.doesNotMatch(JSON.stringify(malformed), /sensitive-canary/)
  await errorResponse(await body(canary, 'text/plain'), 415, 'UNSUPPORTED_MEDIA_TYPE')
  await errorResponse(
    await body(JSON.stringify({ password: canary.repeat(2000) })),
    413,
    'PAYLOAD_TOO_LARGE'
  )

  const errorApp = express()
  errorApp.use(v3RequestContext)
  errorApp.get('/test', () => {
    throw new Error('SELECT password_hash FROM users; ' + canary)
  })
  errorApp.use(v3ErrorHandler)
  const errors = await listen(t, errorApp)
  const unexpected = await errorResponse(await fetch(errors + '/test'), 500, 'INTERNAL_ERROR')
  assert.doesNotMatch(JSON.stringify(unexpected), /sensitive-canary|password_hash|SELECT|stack/)
})
