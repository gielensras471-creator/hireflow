import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createV3App } from '../server/app-v3.js'
import { openDatabase } from '../server/db/database.js'
import { createV3Schema } from '../server/db/schema-v3.js'
import { schemaFingerprint } from '../server/db/v3-database-checks.js'
import {
  initializeV3File,
  migratePersistentV3Auth,
  openPersistentV3
} from '../server/db/persistent-v3.js'
import { startDemoServer } from '../server/index-demo-v3.js'

const oldSecret = randomBytes(18).toString('base64url')
const nextSecret = randomBytes(18).toString('base64url')
const insertUser = (db, username, role = 'hr') =>
  db
    .prepare(
      "INSERT INTO users(username,name,role,password_hash,department,email,phone) VALUES(?,?,?,?,'','','')"
    )
    .run(username, '虚构测试名', role, bcrypt.hashSync(oldSecret, 4))

async function requests(server) {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  return async (path, method = 'GET', token, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    return {
      status: res.status,
      retry: res.headers.get('retry-after'),
      data: res.status === 204 ? null : await res.json()
    }
  }
}
async function formal(t, db, seed = true) {
  if (seed) {
    insertUser(db, 'test-a')
    insertUser(db, 'test-b')
    insertUser(db, 'test-viewer', 'viewer')
  }
  const jwtSecret = randomBytes(48).toString('hex')
  const server = createV3App({ db, authConfig: { jwtSecret }, accountWrites: true }).listen(
    0,
    '127.0.0.1'
  )
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const send = await requests(server)
  const login = (username, password = oldSecret, remember = false) =>
    send('/auth/login', 'POST', undefined, { username, password, remember })
  const token = async (...args) => {
    const result = await login(...args)
    assert.equal(result.status, 200)
    return result.data.token
  }
  return { send, login, token, jwtSecret }
}
const status = (result, expected, code) => {
  assert.equal(result.status, expected)
  if (code) assert.equal(result.data.error.code, code)
}
const credential = (db) =>
  db.prepare('SELECT password_hash, auth_version FROM users WHERE id=1').get()

test('own-account writes preserve identity and snapshots, revoke all old sessions and reject stale business writes', async (t) => {
  const db = openDatabase(':memory:')
  t.after(() => db.close())
  createV3Schema(db)
  const { send, login, token, jwtSecret } = await formal(t, db)
  const a = await token('test-a')
  const remembered = await token('test-a', oldSecret, true)
  const b = await token('test-b')
  const viewer = await token('test-viewer')
  const position = {
    title: '虚构职位',
    department: '虚构部门',
    location: '深圳',
    publishDate: '2026-01-01',
    description: '虚构演示'
  }
  status(await send('/positions', 'POST', a, position), 201)
  const event = db.prepare('SELECT actor_user_id,actor_name_snapshot FROM business_events').get()
  const first = credential(db)
  status(await send('/auth/me', 'PATCH', undefined, { name: '无会话' }), 401, 'AUTH_REQUIRED')
  status(await send('/auth/me', 'PATCH', 'bad-token', { name: '无会话' }), 401, 'INVALID_TOKEN')
  status(await send('/auth/me', 'PATCH', viewer, { name: '无权限' }), 403, 'FORBIDDEN')
  for (const field of ['userId', 'role', 'username', 'accountId', 'isDemo'])
    status(await send('/auth/me', 'PATCH', a, { name: '拒绝', [field]: 2 }), 400, 'INVALID_REQUEST')
  for (const name of [' ', '不\u0000合法', '甲'.repeat(65), '\ud800'])
    status(await send('/auth/me', 'PATCH', a, { name }), 422, 'INVALID_DISPLAY_NAME')
  const renamed = await send('/auth/me', 'PATCH', a, { name: '  林澄  ' })
  status(renamed, 200)
  assert.deepEqual(renamed.data, { id: 1, username: 'test-a', role: 'hr', name: '林澄' })
  assert.equal((await send('/auth/me', 'GET', remembered)).data.name, '林澄')
  assert.equal((await send('/auth/me', 'GET', b)).data.name, '虚构测试名')
  assert.ok(credential(db).password_hash === first.password_hash)
  assert.equal(credential(db).auth_version, first.auth_version)
  assert.deepEqual(
    db.prepare('SELECT actor_user_id,actor_name_snapshot FROM business_events').get(),
    event
  )

  const key = createHmac('sha256', jwtSecret).update('hireflow:v3:access-token').digest()
  const signed = (payload, expiresIn = 60) =>
    jwt.sign({ username: 'test-a', ...payload }, key, {
      issuer: 'hireflow-v3',
      audience: 'hireflow-v3-api',
      subject: '1',
      expiresIn
    })
  const tamperedParts = a.split('.')
  tamperedParts[1] = Buffer.from(JSON.stringify({ ...jwt.decode(a), authVersion: 2 })).toString(
    'base64url'
  )
  for (const invalid of [
    signed({}),
    signed({ authVersion: 2 }),
    signed({ authVersion: 1 }, -60),
    tamperedParts.join('.')
  ])
    status(await send('/auth/me', 'GET', invalid), 401, 'INVALID_TOKEN')

  const rotate = (currentPassword, newPassword, body = {}) =>
    send('/auth/me/password', 'PATCH', a, { currentPassword, newPassword, ...body })
  status(await rotate('wrong-current', nextSecret), 422, 'CURRENT_PASSWORD_INVALID')
  status(await rotate(oldSecret, oldSecret), 422, 'PASSWORD_UNCHANGED')
  status(await rotate(oldSecret, '短密码'), 422, 'INVALID_NEW_PASSWORD')
  status(await rotate(oldSecret, '密'.repeat(25)), 422, 'INVALID_NEW_PASSWORD')
  status(await rotate(oldSecret, nextSecret, { userId: 2 }), 400, 'INVALID_REQUEST')
  assert.equal(credential(db).auth_version, 1)
  status(await rotate(oldSecret, nextSecret), 204)
  assert.equal(credential(db).auth_version, 2)
  assert.ok(credential(db).password_hash !== nextSecret)
  assert.ok(bcrypt.compareSync(nextSecret, credential(db).password_hash))
  for (const stale of [a, remembered]) {
    for (const route of [
      '/auth/me',
      '/dashboard/summary',
      '/positions',
      '/applications',
      '/interviews',
      '/legacy-records/list'
    ])
      status(await send(route, 'GET', stale), 401, 'INVALID_TOKEN')
    status(await send('/positions', 'POST', stale, position), 401, 'INVALID_TOKEN')
  }
  assert.equal(db.prepare('SELECT count(*) n FROM positions').get().n, 1)
  status(await send('/dashboard/summary', 'GET', b), 200)
  status(await login('test-a'), 401, 'INVALID_CREDENTIALS')
  const next = await token('test-a', nextSecret)
  assert.equal(jwt.decode(next).authVersion, 2)
  assert.equal((await send('/auth/me', 'GET', next)).data.name, '林澄')
})

test('concurrent password requests have one winner, and a rejected SQL statement leaves the original credentials intact', async (t) => {
  const db = openDatabase(':memory:')
  t.after(() => db.close())
  createV3Schema(db)
  const { send, token } = await formal(t, db)
  const a = await token('test-a')
  const first = credential(db)
  const change = (newPassword) =>
    send('/auth/me/password', 'PATCH', a, { currentPassword: oldSecret, newPassword })
  db.exec(
    "CREATE TRIGGER fixture_reject_password BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT,'fixture rollback'); END"
  )
  status(await change(nextSecret), 500, 'INTERNAL_ERROR')
  assert.equal(credential(db).auth_version, first.auth_version)
  assert.ok(credential(db).password_hash === first.password_hash)
  db.exec('DROP TRIGGER fixture_reject_password')
  const alternatives = [nextSecret, randomBytes(18).toString('base64url')]
  const results = await Promise.all(alternatives.map(change))
  assert.equal(results.filter((result) => result.status === 204).length, 1)
  const winner = results.findIndex((result) => result.status === 204)
  assert.ok([401, 409].includes(results[1 - winner].status))
  assert.equal(credential(db).auth_version, 2)
  assert.ok(bcrypt.compareSync(alternatives[winner], credential(db).password_hash))

  const b = await token('test-b')
  for (let i = 0; i < 5; i++)
    status(
      await send('/auth/me/password', 'PATCH', b, {
        currentPassword: 'wrong',
        newPassword: nextSecret
      }),
      422,
      'CURRENT_PASSWORD_INVALID'
    )
  const limited = await send('/auth/me/password', 'PATCH', b, {
    currentPassword: 'wrong',
    newPassword: nextSecret
  })
  status(limited, 429, 'PASSWORD_RATE_LIMIT')
  assert.ok(Number(limited.retry) > 0)
})

test('public Demo rejects both mutations through HTTP and preserves seed counts and credentials', async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), 'hf-demo-account-http-'))
  t.after(() => rm(staticDir, { recursive: true, force: true }))
  await writeFile(
    join(staticDir, 'index.html'),
    '<!doctype html><title>Fictional Demo fixture</title>'
  )
  await writeFile(
    join(staticDir, 'demo-build.json'),
    JSON.stringify({
      kind: 'hireflow-isolated-demo',
      apiBase: '/api/v3'
    })
  )
  const demo = await startDemoServer({
    port: 0,
    seed: 'rich',
    staticDir
  })
  t.after(() => demo.close())
  const send = await requests(demo.server)
  const result = await send('/auth/login', 'POST', undefined, {
    username: 'demo_admin',
    password: 'a123456'
  })
  status(result, 200)
  const token = result.data.token
  const before = credential(demo.db)
  status(
    await send('/auth/me?demo=false', 'PATCH', token, { name: '不可修改' }),
    403,
    'ACCOUNT_WRITE_DISABLED'
  )
  status(
    await send('/auth/me/password', 'PATCH', token, {
      currentPassword: 'a123456',
      newPassword: nextSecret
    }),
    403,
    'ACCOUNT_WRITE_DISABLED'
  )
  assert.equal(credential(demo.db).auth_version, before.auth_version)
  assert.ok(credential(demo.db).password_hash === before.password_hash)
  assert.equal((await send('/auth/me', 'GET', token)).data.username, 'demo_admin')
  for (const [path, count] of [
    ['/positions', 24],
    ['/applications', 200],
    ['/interviews', 175]
  ])
    assert.equal((await send(path, 'GET', token)).data.total, count)
})

test('offline migration upgrades authentic legacy metadata, preserves users and business rows, and reruns safely', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hf-account-migration-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const old = join(folder, 'old.db')
  const fresh = join(folder, 'fresh.db')
  const db = openDatabase(':memory:')
  try {
    createV3Schema(db)
    const hash = createHash('sha256')
      .update(
        readFileSync(new URL('../server/db/schema-v3.js', import.meta.url), 'utf8').replace(
          /\r\n/g,
          '\n'
        )
      )
      .digest('hex')
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?,?,?)').run(
      'v3_file_001',
      hash,
      'fresh:fixture',
      Date.now(),
      'fictional test',
      JSON.stringify({ kind: 'fresh_v3_initialization', schemaFingerprint, databaseId: 'fixture' })
    )
    insertUser(db, 'test-a')
    db.exec(
      "INSERT INTO positions(title,department,location,status,publish_date,description) VALUES('虚构职位','虚构部门','深圳','open','2026-01-01','虚构说明')"
    )
    await backup(db, old)
  } finally {
    db.close()
  }
  const disk = new DatabaseSync(old)
  disk.exec('PRAGMA journal_mode=WAL')
  disk.close()
  if (process.platform !== 'win32') await chmod(old, 0o600)

  const legacy = openPersistentV3(folder, old)
  const original = legacy.prepare('SELECT password_hash,name,role,id FROM users').get()
  assert.throws(() => createV3App({ db: legacy }), /Offline V3 auth migration required/)
  legacy.close()
  assert.equal(migratePersistentV3Auth(folder, old, 'fictional test').status, 'upgraded')
  assert.equal(migratePersistentV3Auth(folder, old, 'fictional test').status, 'already-current')
  const current = openPersistentV3(folder, old)
  try {
    const existing = current.prepare('SELECT password_hash,name,role,id FROM users').get()
    assert.ok(existing.password_hash === original.password_hash)
    assert.deepEqual(
      [existing.name, existing.role, existing.id],
      [original.name, original.role, original.id]
    )
    assert.equal(credential(current).auth_version, 1)
    assert.equal(current.prepare('SELECT count(*) n FROM positions').get().n, 1)
    assert.equal(current.prepare('SELECT count(*) n FROM schema_migrations').get().n, 2)
    assert.ok(bcrypt.compareSync(oldSecret, existing.password_hash))
    const api = await formal(t, current, false)
    const oldToken = await api.token('test-a')
    status(
      await api.send('/auth/me/password', 'PATCH', oldToken, {
        currentPassword: oldSecret,
        newPassword: nextSecret
      }),
      204
    )
    status(await api.send('/auth/me', 'GET', oldToken), 401, 'INVALID_TOKEN')
    await api.token('test-a', nextSecret)
    assert.equal(credential(current).auth_version, 2)
  } finally {
    current.close()
  }
  await initializeV3File(folder, fresh, 'fictional test')
  const initialized = openPersistentV3(folder, fresh)
  try {
    assert.equal(initialized.prepare('SELECT count(*) n FROM users').get().n, 0)
    assert.equal(initialized.prepare('SELECT count(*) n FROM schema_migrations').get().n, 2)
  } finally {
    initialized.close()
  }
})
