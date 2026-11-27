import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import bcrypt from 'bcryptjs'
import { createDemoDatabase } from '../server/demo-v3.js'
import { startDemoServer, createDemoRequestGuard } from '../server/index-demo-v3.js'
import { createV3App } from '../server/app-v3.js'
import { openDatabase } from '../server/db/database.js'
import { createV3Schema } from '../server/db/schema-v3.js'

const password = () => randomBytes(18).toString('hex')
const count = (db, table) => db.prepare('SELECT count(*) n FROM ' + table).get().n
async function fixture(t) {
  const staticDir = await mkdtemp(join(tmpdir(), 'hireflow-demo-test-'))
  await writeFile(join(staticDir, 'index.html'), '<html>Isolated test fixture</html>')
  await writeFile(
    join(staticDir, 'demo-build.json'),
    JSON.stringify({ kind: 'hireflow-isolated-demo', apiBase: '/api/v3' })
  )
  const secret = password()
  const app = await startDemoServer({ password: secret, port: 0, staticDir })
  t.after(() => app.close())
  const url = 'http://127.0.0.1:' + app.server.address().port
  const call = async (
    path,
    { token, body, method = body ? 'POST' : 'GET', key = randomUUID() } = {}
  ) => {
    const res = await fetch(url + '/api/v3' + path, {
      method,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': key } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    return { status: res.status, data: await res.json(), headers: res.headers }
  }
  const login = await call('/auth/login', { body: { username: 'demo_admin', password: secret } })
  assert.equal(login.status, 200)
  return { ...app, call, staticDir, password: secret, token: login.data.token }
}

test('demo seed uses legal commands; all facts, events and receipts are consistent', () => {
  const { db } = createDemoDatabase(password())
  try {
    assert.deepEqual(
      { ...db.prepare('SELECT username,name,role FROM users').get() },
      { username: 'demo_admin', name: '招聘管理员（演示）', role: 'hr' }
    )
    assert.equal(count(db, 'users'), 1)
    assert.equal(count(db, 'positions'), 6)
    assert.equal(count(db, 'candidates'), 32)
    assert.equal(count(db, 'interviews'), 18)
    assert.ok(count(db, 'feedback') > 0)
    assert.equal(
      db.prepare("SELECT count(*) n FROM candidates WHERE name NOT LIKE '[虚构演示] %'").get().n,
      0
    )
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM candidates WHERE offer_status='accepted' AND application_status='active' AND outcome IS NULL"
        )
        .get().n,
      1
    )
    assert.equal(count(db, 'business_events'), count(db, 'command_receipts'))
    assert.equal(
      db
        .prepare(
          'SELECT count(*) n FROM business_events e LEFT JOIN command_receipts r USING(command_id) WHERE r.command_id IS NULL'
        )
        .get().n,
      0
    )
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.equal(db.prepare('PRAGMA database_list').get().file, '')
    assert.equal(db.prepare("SELECT count(*) n FROM users WHERE username='hr_admin'").get().n, 0)
  } finally {
    db.close()
  }
})

test('demo rejects absent/default/oversize credentials, no file database option', () => {
  for (const invalid of [undefined, '', 'short', 'x'.repeat(73)])
    assert.throws(() => createDemoDatabase(invalid))
})

test('demo and simulated formal instance reject each other tokens; no account management', async (t) => {
  const f = await fixture(t)
  const db = openDatabase(':memory:')
  createV3Schema(db)
  const formalPassword = password()
  db.prepare(
    'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
  ).run('hr_admin', bcrypt.hashSync(formalPassword, 4), '虚构正式HR', 'hr', '', '', '')
  const server = createV3App({ db, authConfig: { jwtSecret: password() } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise((r) => server.close(r))
    db.close()
  })
  const url = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const res = await fetch(url + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr_admin', password: formalPassword })
  })
  const formalToken = (await res.json()).token
  assert.equal(
    (
      await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'hr_admin', password: 'a123456' })
      })
    ).status,
    401
  )
  assert.equal(
    (await fetch(url + '/positions', { headers: { Authorization: 'Bearer ' + f.token } })).status,
    401
  )
  assert.equal((await f.call('/positions', { token: formalToken })).status, 401)
  const dashboardPath = '/dashboard/history-metrics'
  const readFormalDashboard = (token) =>
    fetch(url + dashboardPath, { headers: { Authorization: 'Bearer ' + token } })
  assert.equal((await readFormalDashboard(f.token)).status, 401)
  assert.equal((await f.call(dashboardPath, { token: formalToken })).status, 401)
  const formalHistory = await readFormalDashboard(formalToken)
  assert.equal(formalHistory.status, 200)
  assert.ok((await formalHistory.json()).applications.months.every(({ count }) => count === 0))
  const demoHistory = await f.call(dashboardPath, { token: f.token })
  assert.equal(demoHistory.status, 200)
  assert.equal(demoHistory.data.applications.months.length, 7)

  assert.equal(
    (await f.call('/auth/login', { body: { username: 'hr_admin', password: formalPassword } }))
      .status,
    401
  )
  assert.equal(
    (await f.call('/users/1', { token: f.token, method: 'PATCH', body: { name: 'blocked' } }))
      .status,
    404
  )
  assert.equal((await f.call('/positions')).status, 401)
  assert.equal(
    (await fetch('http://127.0.0.1:' + f.server.address().port + '/api/positions')).status,
    404
  )
  assert.equal(count(db, 'positions'), 0)
  assert.equal(count(db, 'users'), 1)
  assert.equal(db.prepare('SELECT username FROM users').get().username, 'hr_admin')
})

test('demo HTTP supports complete workflow, version conflict, original-key replay and accurate hire semantics', async (t) => {
  const f = await fixture(t)
  const post = async (path, body, key) => {
    const r = await f.call(path, { body, token: f.token, key })
    assert.ok([200, 201].includes(r.status), JSON.stringify(r))
    return r.data.result
  }
  const p = await post('/positions', {
    title: '[虚构演示] HTTP全流程',
    department: '虚构',
    location: '演示',
    publishDate: '2026-11-17',
    description: '虚构验证'
  })
  const a = await post('/applications', {
    positionId: p.aggregateId,
    name: '[虚构演示] HTTP申请',
    owner: '演示',
    appliedDate: '2026-11-17'
  })
  const id = a.aggregateId,
    version = () => f.db.prepare('SELECT version FROM candidates WHERE id=?').get(id).version
  const advance = (stage) =>
    post('/applications/' + id + '/advance', { expectedVersion: version(), targetStage: stage })
  await advance('first_interview')
  for (const target of ['second_interview', 'offer']) {
    const m = await post('/applications/' + id + '/interviews', {
      expectedVersion: version(),
      scheduledAt: Date.now() - 1000,
      interviewerName: '虚构面试官'
    })
    await post('/applications/' + id + '/interviews/' + m.interviewId + '/complete', {
      expectedVersion: version(),
      interviewVersion: 1
    })
    await post('/applications/' + id + '/interviews/' + m.interviewId + '/feedback', {
      expectedVersion: version(),
      reviewerName: '虚构面试官',
      recommendation: 'recommend',
      reason: '虚构依据'
    })
    await advance(target)
  }
  const path = '/applications/' + id + '/offer/send',
    key = randomUUID(),
    body = { expectedVersion: version() }
  await post(path, body, key)
  const events = count(f.db, 'business_events')
  const replay = await f.call(path, { token: f.token, body, key })
  assert.equal(replay.status, 200)
  assert.equal(replay.data.replayed, true)
  assert.equal(count(f.db, 'business_events'), events)
  assert.equal((await f.call(path, { token: f.token, body })).status, 409)
  await post('/applications/' + id + '/offer/accept', { expectedVersion: version() })
  const accepted = f.db.prepare('SELECT * FROM candidates WHERE id=?').get(id)
  assert.equal(accepted.application_status, 'active')
  assert.equal(accepted.outcome, null)
  await post('/applications/' + id + '/offer/confirm-hire', { expectedVersion: version() })
  assert.equal(f.db.prepare('SELECT outcome FROM candidates WHERE id=?').get(id).outcome, 'hired')
  assert.equal(count(f.db, 'business_events'), count(f.db, 'command_receipts'))
})

test('restart resets changed sandbox and invalidates previous tokens', async (t) => {
  const f = await fixture(t)
  await f.call('/positions', {
    token: f.token,
    body: {
      title: '[虚构演示] 重置前新增',
      department: '',
      location: '',
      publishDate: '2026-11-17',
      description: ''
    }
  })
  assert.equal(count(f.db, 'positions'), 7)
  await f.close()
  const restarted = await startDemoServer({ password: f.password, port: 0, staticDir: f.staticDir })
  t.after(() => restarted.close())
  assert.equal(count(restarted.db, 'positions'), 6)
  assert.equal(count(restarted.db, 'candidates'), 32)
  assert.equal(count(restarted.db, 'interviews'), 18)
  assert.equal(count(restarted.db, 'business_events'), 129)
  assert.equal(count(restarted.db, 'command_receipts'), 129)
  const res = await fetch(
    'http://127.0.0.1:' + restarted.server.address().port + '/api/v3/auth/me',
    { headers: { Authorization: 'Bearer ' + f.token } }
  )
  assert.equal(res.status, 401)
})

test('only a dedicated demo static build is accepted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hireflow-not-demo-'))
  await writeFile(
    join(dir, 'demo-build.json'),
    JSON.stringify({ kind: 'formal', apiBase: 'https://example.invalid/api/v3' })
  )
  await assert.rejects(
    startDemoServer({ password: password(), port: 0, staticDir: dir }),
    /demo build/
  )
})

test('public sandbox enforces HTTP login and read limits', async (t) => {
  const f = await fixture(t)
  for (let i = 0; i < 20; i++)
    await f.call('/auth/login', { body: { username: 'absent', password: 'invalid' } })
  assert.equal(
    (await f.call('/auth/login', { body: { username: 'absent', password: 'invalid' } })).status,
    429
  )
  let response
  for (let i = 0; i < 1801; i++) response = await f.call('/positions', { token: f.token })
  assert.equal(response.status, 429)
  assert.equal(count(f.db, 'positions'), 6)
})

test('lifetime mutation quota survives rate-window rollover and rejects attempt 501', () => {
  let clock = 0
  const guard = createDemoRequestGuard(() => clock)
  const res = {
    code: 200,
    set() {
      return this
    },
    status(code) {
      this.code = code
      return this
    },
    json() {
      return this
    }
  }
  let allowed = 0
  for (let i = 0; i < 501; i++) {
    if (i % 200 === 0) clock += 60001
    res.code = 200
    guard({ path: '/api/v3/positions', method: 'POST' }, res, () => {
      allowed++
    })
  }
  assert.equal(allowed, 500)
  assert.equal(res.code, 429)
})

test('fixed public password works after restart and does not authenticate formal HR', async (t) => {
  const f = await fixture(t)
  await f.close()
  let instance = await startDemoServer({ port: 0, staticDir: f.staticDir })
  const login = async () =>
    fetch('http://127.0.0.1:' + instance.server.address().port + '/api/v3/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo_admin', password: 'a123456' })
    })
  let response = await login()
  assert.equal(response.status, 200)
  const token = (await response.json()).token
  const hash = instance.db.prepare('SELECT password_hash FROM users').get().password_hash
  assert.notEqual(hash, 'a123456')
  assert.ok(bcrypt.compareSync('a123456', hash))
  await instance.close()
  instance = await startDemoServer({ port: 0, staticDir: f.staticDir })
  t.after(() => instance.close())
  assert.equal(
    (
      await fetch('http://127.0.0.1:' + instance.server.address().port + '/api/v3/auth/me', {
        headers: { Authorization: 'Bearer ' + token }
      })
    ).status,
    401
  )
  assert.equal((await login()).status, 200)
})

test('expanded seed history and dashboard agree with actual database facts', async (t) => {
  const f = await fixture(t)
  const r = await f.call('/dashboard/summary', { token: f.token })
  assert.equal(r.status, 200)
  assert.equal(r.data.openPositions.count, 6)
  assert.equal(
    r.data.activeApplications.count,
    f.db.prepare("SELECT count(*) n FROM candidates WHERE application_status='active'").get().n
  )
  assert.equal(r.data.applicationTotals.hired, 1)
  for (const outcome of ['company_rejected', 'candidate_withdrew', 'offer_declined', 'hired'])
    assert.ok(f.db.prepare('SELECT 1 FROM candidates WHERE outcome=?').get(outcome))
  assert.ok(
    f.db.prepare("SELECT 1 FROM business_events WHERE event_type='feedback_supplemented'").get()
  )
  assert.equal(
    f.db
      .prepare(
        'SELECT count(*) n FROM business_events e JOIN command_receipts r USING(command_id) WHERE e.actor_user_id!=r.actor_user_id'
      )
      .get().n,
    0
  )
  assert.equal(
    f.db.prepare('SELECT count(*) n FROM interviews WHERE completed_at<created_at').get().n,
    0
  )
  for (const row of f.db.prepare('SELECT * FROM candidates').all()) {
    const event = f.db
      .prepare(
        "SELECT new_values_json FROM business_events WHERE candidate_id=? AND event_type NOT LIKE 'interview_%' AND event_type NOT LIKE 'feedback_%' ORDER BY id DESC LIMIT 1"
      )
      .get(row.id)
    const snapshot = JSON.parse(event.new_values_json)
    assert.equal(snapshot.stage, row.stage)
    assert.equal(snapshot.outcome, row.outcome)
  }
  const shanghai = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(new Date('2026-11-17T20:00:00Z'))
  assert.equal(shanghai, '04')
})
