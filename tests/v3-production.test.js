import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  initializeV3File,
  openPersistentV3,
  initializeFirstHr,
  backupV3File,
  restoreV3File,
  resolveV3File
} from '../server/db/persistent-v3.js'
import { startV3Server } from '../server/index-v3.js'
import { resolveV3Config } from '../server/config-v3.js'
const record = (name, data) => {
  if (process.env.RELEASE02_EVIDENCE)
    fs.writeFileSync(
      path.join(process.env.RELEASE02_EVIDENCE, name),
      JSON.stringify({ executor: 'Codex', at: new Date().toISOString(), ...data }, null, 2)
    )
}
const port = () =>
  new Promise((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => r(p))
    })
  })
const setup = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-r02-')),
    file = path.join(root, 'v3.db')
  await initializeV3File(root, file, 'Codex fictional release test')
  return { root, file }
}
const credentials = () => ({
  username: 'fictional-release-hr',
  name: '虚构持久库HR',
  password: randomBytes(18).toString('base64url')
})
const counts = (db) =>
  Object.fromEntries(
    [
      'users',
      'positions',
      'candidates',
      'interviews',
      'feedback',
      'business_events',
      'command_receipts'
    ].map((t) => [t, db.prepare('SELECT count(*) n FROM ' + t).get().n])
  )
test('RELEASE02 initialization/version/path gates preserve empty business and original file identity', async () => {
  const { root, file } = await setup(),
    db = openPersistentV3(root, file)
  assert.deepEqual(counts(db), {
    users: 0,
    positions: 0,
    candidates: 0,
    interviews: 0,
    feedback: 0,
    business_events: 0,
    command_receipts: 0
  })
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2)
  assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000)
  assert.throws(() => db.exec("ATTACH DATABASE ':memory:' AS other"))
  assert.throws(() => db.exec('PRAGMA foreign_keys=OFF'))
  db.close()
  await assert.rejects(initializeV3File(root, file, 'test'))
  assert.throws(() => openPersistentV3(root, path.join(root, 'missing.db')))
  assert.ok(!fs.existsSync(path.join(root, 'missing.db')))
  assert.throws(() => resolveV3File(root, path.join(root, '..', 'outside.db')))
  assert.throws(() => resolveV3File('//server/share', '//server/share/a.db'))
  const v2 = new DatabaseSync(path.join(root, 'v2.db'))
  v2.exec('CREATE TABLE candidates(id INTEGER)')
  v2.close()
  const originalV2 = fs.readFileSync(path.join(root, 'v2.db'))
  assert.throws(() => openPersistentV3(root, path.join(root, 'v2.db')))
  assert.deepEqual(fs.readFileSync(path.join(root, 'v2.db')), originalV2)
  const broken = path.join(root, 'broken.db')
  await backupV3File(root, file, broken)
  const bad = new DatabaseSync(broken)
  bad.exec('CREATE TABLE intruder(id INTEGER)')
  bad.close()
  assert.throws(() => openPersistentV3(root, broken))
  const wrong = path.join(root, 'version.db')
  await backupV3File(root, file, wrong)
  const v = new DatabaseSync(wrong)
  v.exec("DROP TRIGGER schema_migrations_no_update; UPDATE schema_migrations SET version='unknown'")
  v.close()
  assert.throws(() => openPersistentV3(root, wrong))
  const linked = path.join(root, 'linked.db')
  fs.linkSync(file, linked)
  assert.throws(() => openPersistentV3(root, linked))
  fs.unlinkSync(linked)
  const again = openPersistentV3(root, file)
  again.close()
})
test('RELEASE02 offline HR is explicit, strong, allowlisted and one-time; no default credentials', async () => {
  const { root, file } = await setup(),
    hr = credentials()
  assert.throws(() => initializeFirstHr(root, file, { ...hr, role: 'owner' }))
  assert.throws(() => initializeFirstHr(root, file, { ...hr, password: 'short' }))
  initializeFirstHr(root, file, { ...hr, role: '招聘管理员' })
  assert.throws(() => initializeFirstHr(root, file, credentials()))
  const db = openPersistentV3(root, file),
    row = db.prepare('SELECT * FROM users').get()
  assert.notEqual(row.password_hash, hr.password)
  assert.equal(row.role, '招聘管理员')
  db.close()
})
test('RELEASE02 production HTTP survives restart, JWT and rows persist, atomic event failure rolls back and verified backups restore', async () => {
  const { root, file } = await setup(),
    hr = credentials()
  initializeFirstHr(root, file, hr)
  const env = {
    NODE_ENV: 'production',
    V3_DATA_ROOT: root,
    V3_DATABASE_PATH: file,
    V3_JWT_SECRET: randomBytes(48).toString('hex'),
    V3_PORT: String(await port())
  }
  for (const key of ['V3_JWT_SECRET', 'V3_DATABASE_PATH', 'V3_DATA_ROOT', 'V3_PORT'])
    assert.throws(() => resolveV3Config({ ...env, [key]: undefined }))
  assert.throws(() => resolveV3Config({ ...env, V3_JWT_SECRET: 'short' }))
  let running = await startV3Server(env)
  try {
    const base = 'http://127.0.0.1:' + env.V3_PORT + '/api/v3',
      response = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: hr.username, password: hr.password })
      }),
      token = (await response.json()).token
    assert.equal(response.status, 200)
    let key = 0
    const call = async (p, body) => {
      const r = await fetch(base + p, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': 'release-' + ++key }
            : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      })
      return { status: r.status, data: await r.json() }
    }
    const job = (
      await call('/positions', {
        title: '虚构持久职位',
        department: '测试',
        location: '上海',
        description: '虚构',
        publishDate: '2026-11-16'
      })
    ).data.result.aggregateId
    const app = (
      await call('/applications', {
        positionId: job,
        name: '虚构持久申请',
        owner: '虚构HR',
        appliedDate: '2026-11-16'
      })
    ).data.result.aggregateId
    const before = counts(running.db),
      version = running.db.prepare('SELECT version FROM candidates WHERE id=?').get(app).version
    running.db.exec(
      "CREATE TRIGGER injected BEFORE INSERT ON business_events WHEN NEW.event_type='stage_advanced' BEGIN SELECT RAISE(ABORT,'fixture failure');END"
    )
    const failed = await call('/applications/' + app + '/advance', {
      expectedVersion: version,
      targetStage: 'first_interview'
    })
    assert.equal(failed.status, 500)
    assert.deepEqual(counts(running.db), before)
    assert.equal(
      running.db.prepare('SELECT version FROM candidates WHERE id=?').get(app).version,
      version
    )
    assert.equal(running.db.isTransaction, false)
    running.db.exec('DROP TRIGGER injected')
    const advanced = await call('/applications/' + app + '/advance', {
      expectedVersion: version,
      targetStage: 'first_interview'
    })
    assert.equal(advanced.status, 200)
    assert.throws(() => running.db.exec('DELETE FROM business_events'))
    assert.throws(() => running.db.exec('DELETE FROM positions'))
    assert.deepEqual(running.db.prepare('PRAGMA foreign_key_check').all(), [])
    const finalCounts = counts(running.db)
    const backup = await backupV3File(root, file, path.join(root, 'snapshot.db'))
    const restored = await restoreV3File(
      root,
      path.join(root, 'snapshot.db'),
      path.join(root, 'restored.db')
    )
    assert.equal(backup.fingerprint, restored.fingerprint)
    await assert.rejects(backupV3File(root, file, file))
    const check = openPersistentV3(root, path.join(root, 'restored.db'))
    assert.deepEqual(counts(check), finalCounts)
    record('RELEASE-02-备份与恢复验证.json', {
      backup,
      restored,
      counts: finalCounts,
      overwriteRefused: true,
      liveSource: true
    })
    check.close()
    await running.close()
    running = await startV3Server(env)
    assert.equal((await call('/auth/me')).status, 200)
    assert.equal((await call('/applications/' + app)).data.stage, 'first_interview')
    assert.deepEqual(counts(running.db), finalCounts)
    assert.equal((await call('/ready')).status, 200)
    record('RELEASE-02-持久化验证.json', {
      counts: finalCounts,
      wal: true,
      synchronous: 'FULL',
      busyTimeout: 5000,
      reopened: true,
      existingJWT: true,
      stage: 'first_interview',
      foreignKeys: running.db.prepare('PRAGMA foreign_key_check').all(),
      transactionFailureRolledBack: true,
      immutableEvents: true
    })
  } finally {
    await running.close()
  }
})
test('RELEASE02 production child process terminates and restarts with existing file (Windows SIGTERM is not a graceful-signal proof)', async () => {
  const { root, file } = await setup(),
    hr = credentials()
  initializeFirstHr(root, file, hr)
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    V3_DATA_ROOT: root,
    V3_DATABASE_PATH: file,
    V3_JWT_SECRET: randomBytes(48).toString('hex'),
    V3_PORT: String(await port())
  }
  const once = async (verify) => {
    const child = spawn(process.execPath, ['server/index-v3.js'], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let text = ''
    child.stdout.on('data', (c) => (text += c))
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        child.kill()
        reject(Error('startup timeout'))
      }, 10000)
      child.on('exit', (c) => {
        clearTimeout(deadline)
        reject(Error('startup refused ' + c))
      })
      const timer = setInterval(() => {
        if (text.includes('ready')) {
          clearInterval(timer)
          clearTimeout(deadline)
          resolve()
        }
      }, 50)
      timer.unref()
    })
    const status = await fetch('http://127.0.0.1:' + env.V3_PORT + '/api/v3/ready')
    assert.equal(status.status, 200)
    await verify('http://127.0.0.1:' + env.V3_PORT)
    const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })))
    child.kill('SIGTERM')
    return exited
  }
  let stableToken
  const first = await once(async (base) => {
      const login = await fetch(base + '/api/v3/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ username: hr.username, password: hr.password })
      })
      assert.equal(login.status, 200)
      stableToken = (await login.json()).token
      const job = await fetch(base + '/api/v3/positions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + stableToken,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'child-persist-job',
          Connection: 'close'
        },
        body: JSON.stringify({
          title: '虚构跨进程职位',
          department: '测试',
          location: '上海',
          description: '虚构',
          publishDate: '2026-11-16'
        })
      })
      assert.equal(job.status, 201)
    }),
    second = await once(async (base) => {
      const me = await fetch(base + '/api/v3/auth/me', {
        headers: { Authorization: 'Bearer ' + stableToken, Connection: 'close' }
      })
      assert.equal(me.status, 200)
      const list = await fetch(base + '/api/v3/positions', {
        headers: { Authorization: 'Bearer ' + stableToken, Connection: 'close' }
      })
      assert.equal((await list.json()).total, 1)
    })
  assert.ok(first.code === 0 || first.signal === 'SIGTERM')
  assert.ok(second.code === 0 || second.signal === 'SIGTERM')
  const db = openPersistentV3(root, file)
  assert.equal(counts(db).users, 1)
  assert.equal(counts(db).positions, 1)
  record('RELEASE-02-启动与重启验证.json', {
    twoRealProcesses: true,
    stableJWT: true,
    positionPersisted: true,
    counts: counts(db),
    processExit: [first, second],
    windowsSignalLimitation: process.platform === 'win32'
  })
  db.close()
})

test('RELEASE02 child process explicitly drains via close(), releases file and port, then reopens', async () => {
  const { root, file } = await setup(),
    hr = credentials()
  initializeFirstHr(root, file, hr)
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    V3_DATA_ROOT: root,
    V3_DATABASE_PATH: file,
    V3_JWT_SECRET: randomBytes(48).toString('hex'),
    V3_PORT: String(await port())
  }
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import {startV3Server} from './server/index-v3.js';const app=await startV3Server();process.send('ready');process.on('message',async()=>{await app.close();process.send('closed');process.disconnect()})"
    ],
    { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
  )
  try {
    await new Promise((resolve, reject) => {
      child.once('message', (m) => (m === 'ready' ? resolve() : reject(Error('not ready'))))
      child.once('error', reject)
    })
    const exit = new Promise((r) => child.once('exit', r)),
      closed = new Promise((r) => child.once('message', r))
    child.send('stop')
    assert.equal(await closed, 'closed')
    assert.equal(await exit, 0)
    const again = await startV3Server(env)
    assert.equal(counts(again.db).users, 1)
    await again.close()
  } finally {
    if (child.connected) child.kill()
  }
})
