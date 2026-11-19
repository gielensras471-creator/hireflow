import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { fixture } from './helpers/v3-db.js'
import { createV3App } from '../server/app-v3.js'
import { resolveV3ApiBase } from '../src/api/v3-api-base.ts'
import { parseV3Origins, validateV3Origins } from '../server/middleware/cors-v3.js'
test('A2 API base only accepts exact HTTPS API host/path or explicit local HTTPS; no duplicate prefix', () => {
  assert.equal(resolveV3ApiBase(), '/api/v3')
  assert.equal(resolveV3ApiBase(''), '/api/v3')
  assert.equal(resolveV3ApiBase('/api/v3'), '/api/v3')
  assert.equal(
    resolveV3ApiBase('https://api.pixelweave.xyz/api/v3/'),
    'https://api.pixelweave.xyz/api/v3'
  )
  assert.equal(resolveV3ApiBase('https://127.0.0.1:54321/api/v3'), 'https://127.0.0.1:54321/api/v3')
  for (const v of [
    'http://api.pixelweave.xyz/api/v3',
    'https://evil.test/api/v3',
    'https://api.pixelweave.xyz.evil.test/api/v3',
    '//api.pixelweave.xyz/api/v3',
    'https://user@api.pixelweave.xyz/api/v3',
    'https://api.pixelweave.xyz/api/v3/api/v3',
    'https://api.pixelweave.xyz/x/../api/v3',
    'https://api.pixelweave.xyz/api/v3?q=1',
    'https://api.pixelweave.xyz/api/v3#x',
    ' https://api.pixelweave.xyz/api/v3',
    'https://api.pixelweave.xyz:444/api/v3',
    'https://api.pixelweave.xyz/%61pi/v3',
    'https:\\api.pixelweave.xyz/api/v3'
  ])
    assert.throws(() => resolveV3ApiBase(v), v)
})
test('A2 Origin configuration is exact, canonical, non-wildcard and defaults closed', () => {
  assert.deepEqual(parseV3Origins(), [])
  assert.deepEqual(parseV3Origins(''), [])
  assert.deepEqual(parseV3Origins('https://hireflow-wed.onrender.com'), [
    'https://hireflow-wed.onrender.com'
  ])
  for (const v of [
    '*',
    'null',
    'https://*.onrender.com',
    'http://example.test',
    'https://example.test/',
    'https://a.test/path',
    'https://u:p@a.test',
    'https://a.test,',
    ' https://a.test',
    'https://a.test#x'
  ])
    assert.throws(() => parseV3Origins(v), v)
  assert.throws(() => validateV3Origins('https://a.test'))
})
test('A2 real HTTP CORS permits only precise origins/methods/headers; authentication, revocation, conflict and replay remain real', async (t) => {
  const { db } = fixture(t)

  const password = randomBytes(18).toString('hex')
  db.prepare(
    'INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
  ).run('a2-fictional', bcrypt.hashSync(password, 10), '虚构HR', 'hr', '', '', '')
  const positionsBefore = db.prepare('SELECT count(*) n FROM positions').get().n
  const origin = 'https://hireflow-wed.onrender.com'
  const app = createV3App({
    db,
    authConfig: { jwtSecret: randomBytes(48).toString('hex') },
    clientOrigins: [origin]
  })
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s))
  })
  t.after(() => new Promise((r) => server.close(r)))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const pre = async (o, m = 'POST', h = 'Content-Type, Authorization, Idempotency-Key') =>
    fetch(base + '/positions', {
      method: 'OPTIONS',
      headers: {
        Origin: o,
        'Access-Control-Request-Method': m,
        'Access-Control-Request-Headers': h
      }
    })
  const p = await pre(origin)
  assert.equal(p.status, 204)
  assert.equal(p.headers.get('access-control-allow-origin'), origin)
  assert.equal(p.headers.get('access-control-allow-credentials'), null)
  assert.match(p.headers.get('vary'), /Origin/)
  for (const bad of [origin + '.evil.test', 'null', 'https://other.test']) {
    const r = await pre(bad)
    assert.equal(r.status, 403)
    assert.equal(r.headers.get('access-control-allow-origin'), null)
  }
  for (const [m, h] of [
    ['DELETE', 'Authorization'],
    ['PUT', 'Authorization'],
    ['POST', 'X-Unapproved']
  ])
    assert.equal((await pre(origin, m, h)).status, 403)
  const unauth = await fetch(base + '/positions', { headers: { Origin: origin } })
  assert.equal(unauth.status, 401)
  assert.equal(unauth.headers.get('access-control-allow-origin'), origin)
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'a2-fictional', password })
  })
  assert.equal(login.status, 200)
  const token = (await login.json()).token
  const headers = {
    Origin: origin,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'a2-stable-key'
  }
  const body = {
    title: '虚构跨域职位',
    department: '测试',
    location: '上海',
    description: '虚构',
    publishDate: '2026-11-16'
  }
  const write = () =>
    fetch(base + '/positions', { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await write()).status, 201)
  const replay = await write()
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).replayed, true)
  const conflict = await fetch(base + '/positions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, title: '不同意图' })
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.headers.get('access-control-allow-origin'), origin)
  assert.equal(db.prepare('SELECT count(*) n FROM positions').get().n, positionsBefore + 1)
  assert.equal(db.prepare('SELECT count(*) n FROM business_events').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM command_receipts').get().n, 1)
  db.exec("UPDATE users SET role='viewer'")
  const denied = await fetch(base + '/positions', {
    headers: { Origin: origin, Authorization: 'Bearer ' + token }
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), origin)
  const badOrigin = await fetch(base + '/auth/me', {
    headers: { Origin: 'https://other.test', Authorization: 'Bearer ' + token }
  })
  assert.equal(badOrigin.headers.get('access-control-allow-origin'), null)
  const noOrigin = await fetch(base + '/positions')
  assert.equal(noOrigin.status, 401)
})

test('A2 empty default origin list grants no cross-origin preflight permission', async (t) => {
  const { db } = fixture(t),
    app = createV3App({ db, authConfig: { jwtSecret: randomBytes(48).toString('hex') } })
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s))
  })
  t.after(() => new Promise((r) => server.close(r)))
  const base = 'http://127.0.0.1:' + server.address().port
  const response = await fetch(base + '/api/v3/positions', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://hireflow-wed.onrender.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization'
    }
  })
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.equal((await fetch(base + '/api/v3/positions')).status, 401)
})
