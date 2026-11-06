import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { createV3App } from '../server/app-v3.js'
import { fixture, insert } from './helpers/v3-db.js'

const password = 'fictional-recruiting-password'
const position = (title = 'Platform Engineer') => ({
  title,
  department: 'Engineering',
  location: 'Shanghai',
  publishDate: '2026-11-06',
  description: 'Fixture'
})
const application = (positionId) => ({
  positionId,
  name: 'Fixture Applicant',
  owner: 'Test HR',
  appliedDate: '2026-11-06',
  email: 'fixture@example.invalid',
  phone: 'fictional',
  note: 'Private fixture note'
})
const failure = (response, status, code) => {
  assert.equal(response.status, status, JSON.stringify(response.data))
  assert.deepEqual(Object.keys(response.data), ['error'])
  assert.deepEqual(Object.keys(response.data.error).sort(), ['code', 'message', 'requestId'])
  assert.equal(response.data.error.code, code)
  assert.equal(response.data.error.requestId, response.headers.get('x-request-id'))
  assert.ok(response.data.error.requestId)
}
const receipt = (response, status) => {
  assert.equal(response.status, status, JSON.stringify(response.data))
  assert.equal(response.data.replayed, false)
  assert.ok(response.data.result.commandId)
  return response.data.result
}
const setup = async (t) => {
  const f = fixture(t)
  const hash = bcrypt.hashSync(password, 4)
  f.db.prepare("UPDATE users SET password_hash=?,role='hr' WHERE id=1").run(hash)
  insert(f.db, 'users', {
    id: 2,
    username: 'viewer-test',
    password_hash: hash,
    name: 'Test Viewer',
    role: 'viewer',
    department: '',
    email: '',
    phone: ''
  })
  const app = createV3App({ db: f.db, authConfig: { jwtSecret: randomBytes(32).toString('hex') } })
  const server = app.listen(0, '127.0.0.1')
  t.after(
    () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  )
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const request = async (path, { method = 'GET', token, body, key } = {}) => {
    const headers = {}
    if (token) headers.Authorization = 'Bearer ' + token
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (key !== undefined) headers['Idempotency-Key'] = key
    const response = await fetch(base + path, { method, headers, body: JSON.stringify(body) })
    return { status: response.status, headers: response.headers, data: await response.json() }
  }
  const login = async (username) => {
    const result = await request('/auth/login', { method: 'POST', body: { username, password } })
    assert.equal(result.status, 200)
    return result.data.token
  }
  const token = await login('hr-test')
  const get = (path) => request(path, { token })
  const write = (path, body, method = 'POST', key = randomUUID()) =>
    request(path, { method, token, body, key })
  const counts = () =>
    ['positions', 'candidates', 'business_events', 'command_receipts'].map(
      (table) => f.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n
    )
  return { ...f, request, login, token, get, write, counts }
}

test('E3-API-02 all eleven business routes require an authenticated current HR', async (t) => {
  const f = await setup(t)
  const viewer = await f.login('viewer-test')
  const routes = [
    ['GET', '/positions'],
    ['GET', '/positions/options'],
    ['GET', '/positions/1'],
    ['POST', '/positions'],
    ['PATCH', '/positions/1'],
    ['POST', '/positions/1/status'],
    ['POST', '/positions/1/archive'],
    ['GET', '/applications'],
    ['GET', '/applications/1'],
    ['POST', '/applications'],
    ['PATCH', '/applications/1']
  ]
  const before = f.counts()
  for (const [method, path] of routes) {
    failure(await f.request(path, { method }), 401, 'AUTH_REQUIRED')
    failure(await f.request(path, { method, token: viewer }), 403, 'FORBIDDEN')
  }
  assert.equal((await f.get('/positions')).status, 200)
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1")
  failure(await f.get('/applications'), 403, 'FORBIDDEN')
  failure(await f.write('/positions', position()), 403, 'FORBIDDEN')
  assert.deepEqual(f.counts(), before)
})

test('E3-API-02 stable same-name positions support rename, close, reopen and audited soft archive', async (t) => {
  const f = await setup(t)
  const first = receipt(await f.write('/positions', position()), 201)
  const second = receipt(await f.write('/positions', position()), 201)
  const id = first.aggregateId
  const other = second.aggregateId
  assert.notEqual(id, other)
  const app = receipt(await f.write('/applications', application(id)), 201)
  receipt(await f.write('/applications', application(other)), 201)
  const path = '/positions/' + id
  assert.equal((await f.get(path)).data.applicationRecords, 1)
  assert.equal((await f.get('/positions/' + other)).data.applicationRecords, 1)
  assert.equal(
    receipt(await f.write(path, { expectedVersion: 1, title: 'Renamed' }, 'PATCH'), 200).version,
    2
  )
  const related = (await f.get('/applications/' + app.aggregateId)).data
  assert.deepEqual([related.positionId, related.positionTitle], [id, 'Renamed'])

  const close = await f.write(path + '/status', { expectedVersion: 2, status: 'closed' })
  assert.equal(receipt(close, 200).version, 3)
  assert.deepEqual(close.data.risk, {
    applicationRecords: 1,
    activeApplications: 1,
    legacyReferences: 0,
    warning: 'POSITION_HAS_ACTIVE_APPLICATIONS'
  })
  failure(await f.write('/applications', application(id)), 409, 'POSITION_NOT_OPEN')
  assert.equal(
    (await f.get('/positions/options')).data.some((row) => row.id === id),
    false
  )
  assert.equal((await f.get('/applications/' + app.aggregateId)).data.applicationStatus, 'active')
  assert.equal(
    receipt(await f.write(path + '/status', { expectedVersion: 3, status: 'open' }), 200).version,
    4
  )
  assert.equal(
    (await f.get('/positions/options')).data.some((row) => row.id === id),
    true
  )
  const archive = await f.write(path + '/archive', { expectedVersion: 4 })
  assert.equal(receipt(archive, 200).version, 5)
  assert.equal(archive.data.risk.deletion, 'soft')
  assert.equal(archive.data.risk.activeApplications, 1)
  const archived = (await f.get(path)).data
  assert.ok(archived.deletedAt)
  assert.equal(archived.applicationRecords, 1)
  assert.equal(
    (await f.get('/positions/options')).data.some((row) => row.id === id),
    false
  )
  failure(await f.write('/applications', application(id)), 409, 'POSITION_NOT_OPEN')
  failure(
    await f.write(path + '/status', { expectedVersion: 5, status: 'open' }),
    409,
    'POSITION_DELETED'
  )
  assert.equal((await f.get('/applications/' + app.aggregateId)).data.positionId, id)
  const events = f.db
    .prepare('SELECT event_type,actor_user_id FROM business_events WHERE position_id=? ORDER BY id')
    .all(id)
  assert.deepEqual(
    events.map((e) => e.event_type),
    [
      'position_created',
      'position_updated',
      'position_status_changed',
      'position_status_changed',
      'position_deleted'
    ]
  )
  assert.ok(events.every((e) => e.actor_user_id === 1))
})

test('E3-API-02 application details allow profile edits and reject reassignment, lifecycle edits and closed updates', async (t) => {
  const f = await setup(t)
  const pos = receipt(await f.write('/positions', position()), 201)
  const created = receipt(await f.write('/applications', application(pos.aggregateId)), 201)
  const path = '/applications/' + created.aggregateId
  const detail = (await f.get(path)).data
  assert.deepEqual(
    [detail.stage, detail.applicationStatus, detail.outcome, detail.offerStatus, detail.version],
    ['screening', 'active', null, null, 1]
  )
  assert.equal(detail.email, 'fixture@example.invalid')
  assert.ok(!Object.hasOwn(detail, 'position_id'))
  assert.ok(!Object.hasOwn(detail, 'passwordHash'))
  const listItem = (await f.get('/applications')).data.items[0]
  for (const key of ['email', 'phone', 'note', 'closedReason', 'passwordHash'])
    assert.ok(!Object.hasOwn(listItem, key))
  assert.equal(
    receipt(
      await f.write(
        path,
        { expectedVersion: 1, note: 'Edited', school: 'Fixture School' },
        'PATCH'
      ),
      200
    ).version,
    2
  )
  assert.equal((await f.get(path)).data.note, 'Edited')

  const before = f.counts()
  for (const [key, value] of Object.entries({
    positionId: f.firstPosition,
    stage: 'offer',
    applicationStatus: 'closed',
    outcome: 'hired',
    offerStatus: 'sent',
    actor: 99,
    command: 'application.close',
    aggregateId: 99,
    history: []
  }))
    failure(
      await f.write(path, { expectedVersion: 2, [key]: value }, 'PATCH'),
      422,
      'INVALID_FIELDS'
    )
  failure(await f.request(path, { method: 'DELETE', token: f.token }), 404, 'NOT_FOUND')
  f.db
    .prepare(
      "UPDATE candidates SET application_status='closed',outcome='candidate_withdrew',closed_at=created_at,closed_reason='Fixture closure' WHERE id=?"
    )
    .run(created.aggregateId)
  failure(
    await f.write(path, { expectedVersion: 2, note: 'Rejected' }, 'PATCH'),
    409,
    'APPLICATION_CLOSED'
  )
  assert.deepEqual(f.counts(), before)
  assert.equal((await f.get(path)).data.note, 'Edited')
})

test('E3-API-02 SQL lists filter and page in ID order with bounded inputs and safe DTOs', async (t) => {
  const f = await setup(t)
  const a = receipt(await f.write('/positions', position('Filter job A')), 201).aggregateId
  const b = receipt(await f.write('/positions', position('Filter job B')), 201).aggregateId
  const c = receipt(await f.write('/positions', position('Filter job C')), 201).aggregateId
  receipt(
    await f.write('/positions/' + c + '/status', { status: 'closed', expectedVersion: 1 }),
    200
  )
  const positionPage = (await f.get('/positions?q=FILTER&status=open&limit=1&offset=1')).data
  assert.deepEqual(
    [
      positionPage.items.map((p) => p.id),
      positionPage.total,
      positionPage.limit,
      positionPage.offset
    ],
    [[b], 2, 1, 1]
  )
  const apps = []
  for (const positionId of [a, b, a])
    apps.push(receipt(await f.write('/applications', application(positionId)), 201).aggregateId)
  const page = (
    await f.get(
      '/applications?positionId=' +
        a +
        '&stage=screening&applicationStatus=active&q=fixture&limit=1&offset=1'
    )
  ).data
  assert.deepEqual(
    [page.items.map((row) => row.id), page.total, page.limit, page.offset],
    [[apps[2]], 2, 1, 1]
  )
  const empty = (await f.get('/applications?positionId=' + a + '&offset=10')).data
  assert.deepEqual([empty.items, empty.total], [[], 2])
  assert.equal((await f.get('/positions?q=' + encodeURIComponent("' OR 1=1 --"))).data.total, 0)
  for (const path of [
    '/positions?status=unknown',
    '/positions?limit=0',
    '/positions?limit=101',
    '/positions?offset=-1',
    '/positions?q=a&q=b',
    '/positions?unexpected=1',
    '/positions?__proto__=1',
    '/positions?q[x]=filter',
    '/applications?stage=rejected',
    '/applications?applicationStatus=other',
    '/applications?positionId=1.5',
    '/applications?positionId=9007199254740992',
    '/applications?offset=1e2'
  ])
    assert.equal((await f.get(path)).status, 400, path)
  failure(await f.get('/positions/%E0%A4%A'), 400, 'INVALID_REQUEST')
  failure(await f.get('/positions/99999'), 404, 'AGGREGATE_NOT_FOUND')
  failure(await f.get('/applications/99999'), 404, 'AGGREGATE_NOT_FOUND')
  failure(
    await f.write('/applications/99999', { expectedVersion: 1, note: 'missing' }, 'PATCH'),
    404,
    'AGGREGATE_NOT_FOUND'
  )
})

test('E3-API-02 versions and idempotent replays preserve exactly one receipt and audited effect', async (t) => {
  const f = await setup(t)
  const before = f.counts()
  const key = randomUUID()
  const created = await f.write('/positions', position(), 'POST', key)
  const result = receipt(created, 201)
  const replay = await f.write('/positions', position(), 'POST', key)
  assert.equal(replay.status, 200)
  assert.deepEqual(replay.data, { ...created.data, replayed: true })
  failure(
    await f.write('/positions', position('different'), 'POST', key),
    409,
    'IDEMPOTENCY_CONFLICT'
  )
  const path = '/positions/' + result.aggregateId
  const editKey = randomUUID()
  const change = { expectedVersion: 1, title: 'Updated' }
  const update = await f.write(path, change, 'PATCH', editKey)
  assert.equal(receipt(update, 200).version, 2)
  assert.deepEqual((await f.write(path, change, 'PATCH', editKey)).data, {
    ...update.data,
    replayed: true
  })
  failure(await f.write(path, change, 'PATCH'), 409, 'VERSION_CONFLICT')
  failure(await f.write(path, { ...change, expectedVersion: 2 }, 'PATCH'), 409, 'NO_CHANGE')
  failure(await f.write(path, { title: 'No version' }, 'PATCH'), 400, 'INVALID_VERSION')
  failure(
    await f.request('/positions', { method: 'POST', token: f.token, body: position() }),
    400,
    'INVALID_IDEMPOTENCY_KEY'
  )
  failure(
    await f.write('/positions', { ...position(), publishDate: '2026-02-30' }),
    422,
    'INVALID_DATE'
  )
  failure(await f.write('/positions', { title: 'Missing fields' }), 422, 'MISSING_FIELD')
  assert.deepEqual(f.counts(), [before[0] + 1, before[1], before[2] + 2, before[3] + 2])
  const events = f.db
    .prepare('SELECT command_id,aggregate_version FROM business_events ORDER BY id')
    .all()
  assert.deepEqual(
    events.map((e) => [e.command_id, e.aggregate_version]),
    [
      [result.commandId, 1],
      [update.data.result.commandId, 2]
    ]
  )
})

test('E3-API-02 HTTP write failures roll back the mutation and expose only safe errors', async (t) => {
  const f = await setup(t)
  const pos = receipt(await f.write('/positions', position()), 201)
  const path = '/positions/' + pos.aggregateId
  const before = f.counts()
  f.db.exec(
    "CREATE TEMP TRIGGER fail_event BEFORE INSERT ON main.business_events BEGIN SELECT RAISE(ABORT,'sensitive SQL canary'); END"
  )
  const key = randomUUID()
  const change = { expectedVersion: 1, title: 'Atomic update' }
  const failed = await f.write(path, change, 'PATCH', key)
  failure(failed, 500, 'INTERNAL_ERROR')
  assert.doesNotMatch(JSON.stringify(failed.data), /sensitive|SQL|business_events|stack/)
  failure(await f.write('/applications', application(pos.aggregateId)), 500, 'INTERNAL_ERROR')
  assert.deepEqual(f.counts(), before)
  const unchanged = (await f.get(path)).data
  assert.deepEqual([unchanged.title, unchanged.version], [position().title, 1])
  f.db.exec('DROP TRIGGER temp.fail_event')
  const exec = f.db.exec.bind(f.db)
  const mock = t.mock.method(f.db, 'exec', (sql) => {
    if (sql === 'BEGIN IMMEDIATE') throw new Error('database is locked: sensitive canary')
    return exec(sql)
  })
  const busy = await f.write(path, change, 'PATCH', key)
  failure(busy, 503, 'COMMAND_BUSY')
  assert.equal(busy.headers.get('retry-after'), '1')
  assert.deepEqual(f.counts(), before)
  mock.mock.restore()
  assert.equal(receipt(await f.write(path, change, 'PATCH', key), 200).version, 2)
  assert.deepEqual(f.counts(), [before[0], before[1], before[2] + 1, before[3] + 1])
})
