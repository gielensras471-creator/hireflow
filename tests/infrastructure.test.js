import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import http from 'node:http'
import { createTokenService } from '../server/utils/jwt.js'
import fs from 'node:fs'
import { once } from 'node:events'
import { openDatabase } from '../server/db/database.js'
import { createSchema } from '../server/db/schema.js'
import { seedDatabase } from '../server/db/seed.js'
import { resolveServerConfig } from '../server/config.js'
import { createApp } from '../server/app.js'
import { createTestApp, testConfig } from './helpers/test-app.js'
import {
  createTestDatabase,
  createTestWorkspace,
  openTestDatabase,
  removeTestWorkspace
} from './helpers/test-db.js'

test('connection requires an explicit path and does not initialize schema', (t) => {
  assert.throws(() => openDatabase(), /explicit/)
  assert.throws(() => openDatabase('relative.db'), /explicit/)
  const db = openDatabase(':memory:')
  t.after(() => db.close())
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n, 0)
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  createSchema(db)
  createSchema(db)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0)
})

test('test database factory ignores production environment paths', (t) => {
  const original = process.env.DATABASE_PATH
  process.env.DATABASE_PATH = path.resolve('server/data/MUST-NOT-OPEN.db')
  t.after(() => {
    if (original === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = original
  })
  const db = createTestDatabase()
  t.after(() => db.close())
  assert.equal(db.prepare('PRAGMA database_list').get().file, '')
})

test('configuration resolves only the explicitly supplied environment', () => {
  const config = resolveServerConfig({
    PORT: '4321',
    JWT_SECRET: 'explicit',
    CLIENT_ORIGIN: 'http://test',
    NODE_ENV: 'production'
  })
  assert.equal(config.port, 4321)
  assert.equal(config.jwtSecret, 'explicit')
  assert.equal(config.isProduction, true)
  assert.deepEqual(config.clientOrigins, ['http://test'])
  assert.throws(() => createApp({}), /explicit/)
})

test('separate test connections cannot share records', (t) => {
  const a = createTestDatabase()
  const b = createTestDatabase()
  t.after(() => {
    a.close()
    b.close()
  })
  a.exec(
    "INSERT INTO positions(title,department,location,status,publish_date,description) VALUES('Test','Test','Test','open','2026-01-01','Test')"
  )
  assert.equal(a.prepare('SELECT COUNT(*) n FROM positions').get().n, 1)
  assert.equal(b.prepare('SELECT COUNT(*) n FROM positions').get().n, 0)
})

test('explicit seed remains empty-only and repeatable', (t) => {
  const db = createTestDatabase()
  t.after(() => db.close())
  const fixture = { positions: [], candidates: [], interviews: [] }
  seedDatabase(db, fixture)
  seedDatabase(db, fixture)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM positions').get().n, 0)
})

test('existing synchronous transaction rolls back and preserves original error', (t) => {
  const db = createTestDatabase()
  t.after(() => db.close())
  const error = new Error('injected failure')
  assert.throws(
    db.transaction(() => {
      db.exec(
        "INSERT INTO positions(title,department,location,status,publish_date,description) VALUES('Test','Test','Test','open','2026-01-01','Test')"
      )
      throw error
    }),
    (actual) => actual === error
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM positions').get().n, 0)
})

test('file database paths are confined to factory-owned temporary roots', (t) => {
  const root = createTestWorkspace()
  t.after(() => removeTestWorkspace(root))
  assert.throws(() =>
    openTestDatabase({ root, databasePath: path.resolve('server/data/hireflow.db') })
  )
  assert.throws(() =>
    openTestDatabase({ root, databasePath: path.resolve(root, '..', 'escape.db') })
  )
  assert.throws(() =>
    openTestDatabase({ root: path.dirname(root), databasePath: path.join(root, 'a.db') })
  )
  const file = path.join(root, 'isolated.db')
  const db = createTestDatabase({ root, databasePath: file })
  db.exec(
    "INSERT INTO positions(title,department,location,status,publish_date,description) VALUES('Test','Test','Test','open','2026-01-01','Test')"
  )
  db.close()
  const reopened = openTestDatabase({ root, databasePath: file })
  assert.equal(reopened.prepare('SELECT COUNT(*) n FROM positions').get().n, 1)
  reopened.close()
  assert.equal(fs.existsSync(file), true)
})

test('two injected HTTP applications retain auth, CRUD, profile and database isolation', async (t) => {
  const first = createTestApp()
  const second = createTestApp()
  seedDatabase(first.db, { positions: [], candidates: [], interviews: [] })
  const servers = [first.app.listen(0, '127.0.0.1'), second.app.listen(0, '127.0.0.1')]
  t.after(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
    )
    first.db.close()
    second.db.close()
  })
  await Promise.all(servers.map((server) => once(server, 'listening')))
  const base = 'http://127.0.0.1:' + servers[0].address().port + '/api'
  assert.equal((await fetch(base + '/health')).status, 200)
  assert.equal((await fetch(base + '/positions')).status, 401)
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456', remember: false })
  })
  assert.equal(login.status, 200)
  const session = await login.json()
  assert.ok(session.token)
  assert.equal('passwordHash' in session.user, false)
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.token }
  const request = (url, method, body) =>
    fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  assert.equal((await request('/auth/me', 'GET')).status, 200)
  assert.equal(
    (
      await request('/profile', 'PATCH', {
        name: 'Test HR',
        department: 'Test',
        email: 'test@example.invalid',
        phone: '13800000000'
      })
    ).status,
    200
  )
  const positionResponse = await request('/positions', 'POST', {
    title: 'Test Role',
    department: 'Test',
    location: 'Test',
    status: 'open',
    publishDate: '2026-01-01',
    description: 'Test'
  })
  assert.equal(positionResponse.status, 201)
  const position = await positionResponse.json()
  const candidateResponse = await request('/candidates', 'POST', {
    name: 'Test Person',
    position: position.title,
    education: 'Test',
    school: 'Test',
    phone: '13800000000',
    email: 'test@example.invalid',
    stage: 'screening',
    owner: 'Test HR',
    appliedDate: '2026-01-01'
  })
  assert.equal(candidateResponse.status, 201)
  const candidate = await candidateResponse.json()
  const interviewResponse = await request('/interviews', 'POST', {
    candidateId: candidate.id,
    candidateName: candidate.name,
    position: position.title,
    date: '2026-01-02',
    time: '10:00',
    interviewer: 'Test',
    type: '初面',
    status: 'scheduled'
  })
  assert.equal(interviewResponse.status, 201)
  const interview = await interviewResponse.json()
  assert.equal((await request('/interviews', 'GET')).status, 200)
  assert.equal((await request('/positions', 'GET')).status, 200)
  assert.equal((await request('/candidates', 'GET')).status, 200)
  const counted = await (await request('/positions/' + position.id, 'GET')).json()
  assert.equal(counted.candidateCount, 1)
  assert.equal(
    (await request('/interviews/' + interview.id, 'PATCH', { status: 'completed' })).status,
    200
  )
  assert.equal((await request('/candidates/' + candidate.id, 'GET')).status, 200)
  assert.equal(
    (await request('/candidates/' + candidate.id, 'PATCH', { stage: 'first_interview' })).status,
    200
  )
  assert.equal((await request('/interviews/' + interview.id, 'DELETE')).status, 204)
  assert.equal((await request('/candidates/' + candidate.id, 'DELETE')).status, 204)
  assert.equal((await request('/positions/' + position.id, 'DELETE')).status, 204)
  assert.equal(
    (
      await request('/profile/password', 'PATCH', {
        currentPassword: 'wrong',
        newPassword: 'test-only-password'
      })
    ).status,
    400
  )
  assert.equal(
    (
      await request('/profile/password', 'PATCH', {
        currentPassword: '123456',
        newPassword: 'test-only-password'
      })
    ).status,
    200
  )
  const secondBase = 'http://127.0.0.1:' + servers[1].address().port + '/api'
  const otherLogin = await fetch(secondBase + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' })
  })
  assert.equal(otherLogin.status, 401)
  assert.equal(second.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0)
  assert.equal(testConfig.jwtSecret, 'isolated-test-secret-only')
})

test('constructing an injected application does not listen or load external config', (t) => {
  t.mock.method(http.Server.prototype, 'listen', () => {
    throw new Error('Unexpected listener')
  })
  const { db, app } = createTestApp()
  t.after(() => db.close())
  assert.equal(typeof app, 'function')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0)
})

test('JWT service secrets belong to each application instance', () => {
  const first = createTokenService('first-isolated-test-secret')
  const second = createTokenService('second-isolated-test-secret')
  const { token } = first.signAccessToken({ id: 1, username: 'test', role: 'test' })
  assert.equal(first.verifyAccessToken(token).sub, '1')
  assert.throws(() => second.verifyAccessToken(token))
})
