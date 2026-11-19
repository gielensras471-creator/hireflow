import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { fixture, insert } from './helpers/v3-db.js'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import { createCommandCore, canonicalRequest } from '../server/services/command-core.js'
const build = (db) => {
  const sessions = new WeakMap(),
    context = {}
  sessions.set(context, 1)
  const core = createCommandCore({
    db,
    resolveActor: (c) => sessions.get(c),
    authorize: (u) => u.role === 'hr'
  })
  core.register('rename', {
    aggregate: 'position',
    eventType: 'position_updated',
    change: (_old, p) => ({ title: p.title })
  })
  return { ...core, context, sessions }
}
const setup = (t) => {
  const f = fixture(t)
  f.db.exec("UPDATE users SET role='hr' WHERE id=1")
  return { ...f, ...build(f.db) }
}
const req = (extra = {}) => ({
  command: 'rename',
  aggregateId: 1,
  expectedVersion: 1,
  idempotencyKey: 'key',
  payload: { title: 'Updated' },
  ...extra
})
const counts = (db) =>
  ['command_receipts', 'business_events'].map(
    (table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n
  )
const code = (value) => (e) => e.code === value

test('DEV-04 atomic update derives actor, actual row snapshots, version and shared command ID', (t) => {
  const f = setup(t),
    start = Date.now(),
    before = { ...f.db.prepare('SELECT * FROM positions WHERE id=1').get() }
  const r = f.execute(f.context, req())
  const event = f.db.prepare('SELECT * FROM business_events').get(),
    receipt = f.db.prepare('SELECT * FROM command_receipts').get()
  assert.equal(r.result.version, 2)
  assert.equal(event.aggregate_version, 2)
  assert.equal(event.command_id, receipt.command_id)
  assert.equal(event.actor_user_id, 1)
  assert.equal(event.actor_name_snapshot, 'Test HR')
  assert(event.occurred_at >= start && event.occurred_at <= Date.now())
  assert.deepEqual(JSON.parse(event.old_values_json), before)
  assert.deepEqual(JSON.parse(event.new_values_json), {
    ...f.db.prepare('SELECT * FROM positions WHERE id=1').get()
  })
  assert.deepEqual(counts(f.db), [1, 1])
  assert.throws(() => f.db.exec("UPDATE business_events SET reason='edited'"), /immutable/)
})

test('DEV-04 canonical retries execute once, reject changed request and scope keys per actual actor', (t) => {
  const f = setup(t),
    a = f.execute(f.context, req())
  const b = f.execute(f.context, {
    payload: { title: 'Updated' },
    idempotencyKey: 'key',
    expectedVersion: 1,
    aggregateId: 1,
    command: 'rename'
  })
  assert(b.replayed)
  assert.deepEqual(b.result, a.result)
  assert.deepEqual(counts(f.db), [1, 1])
  assert.throws(
    () => f.execute(f.context, req({ payload: { title: 'different' } })),
    code('IDEMPOTENCY_CONFLICT')
  )
  const user = {
    ...f.db.prepare('SELECT * FROM users WHERE id=1').get(),
    id: 2,
    username: 'hr-two'
  }
  insert(f.db, 'users', user)
  const other = {}
  f.sessions.set(other, 2)
  f.execute(other, req({ expectedVersion: 2 }))
  assert.deepEqual(counts(f.db), [2, 2])
  assert.equal(f.db.prepare('SELECT version FROM positions WHERE id=1').get().version, 3)
})

test('DEV-04 stale versions, missing aggregates and fabricated audit identities leave no effects', (t) => {
  const f = setup(t)
  assert.throws(() => f.execute({}, req()), code('INVALID_ACTOR'))
  assert.throws(() => f.execute(f.context, req({ actor_user_id: 2 })), code('INVALID_REQUEST'))
  assert.throws(() => f.execute(f.context, req({ expectedVersion: 2 })), code('VERSION_CONFLICT'))
  assert.throws(() => f.execute(f.context, req({ aggregateId: 999 })), code('AGGREGATE_NOT_FOUND'))
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  assert.throws(() => f.execute(f.context, req()), code('FORBIDDEN'))
  f.db.exec('DELETE FROM users WHERE id=1')
  assert.throws(() => f.execute(f.context, req()), code('INVALID_ACTOR'))
  assert.deepEqual(counts(f.db), [0, 0])
})

test('DEV-04 receipt insertion or event insertion failures roll back aggregate and all audit writes', (t) => {
  const f = setup(t),
    before = { ...f.db.prepare('SELECT * FROM positions WHERE id=1').get() }
  for (const table of ['command_receipts', 'business_events']) {
    f.db.exec(
      'CREATE TRIGGER injected BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'injected write failure'); END"
    )
    assert.throws(() => f.execute(f.context, req()), /injected write failure/)
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM positions WHERE id=1').get() }, before)
    assert.deepEqual(counts(f.db), [0, 0])
    assert(!f.db.isTransaction)
    f.db.exec('DROP TRIGGER injected')
  }
  f.db.exec(
    "CREATE TRIGGER after_event AFTER INSERT ON business_events BEGIN SELECT RAISE(ABORT,'failure after event insert'); END"
  )
  assert.throws(() => f.execute(f.context, req()), /failure after event/)
  assert.deepEqual(counts(f.db), [0, 0])
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM positions WHERE id=1').get() }, before)
})

test('DEV-04 candidate aggregates supported; illegal event scopes and FKs roll back', (t) => {
  const f = setup(t),
    id = f.candidate()
  f.register('note', {
    aggregate: 'candidate',
    eventType: 'candidate_updated',
    change: () => ({ note: 'Server checked' })
  })
  f.execute(f.context, req({ command: 'note', aggregateId: id }))
  const e = f.db.prepare('SELECT * FROM business_events').get()
  assert.equal(e.candidate_id, id)
  assert.equal(e.position_id, null)
  for (const [name, def] of [
    ['bad-type', { eventType: 'made_up' }],
    ['bad-scope', { eventType: 'candidate_updated' }],
    ['bad-fk', { describe: () => ({ interviewId: 999 }) }]
  ]) {
    f.register(name, {
      aggregate: 'position',
      eventType: 'position_updated',
      change: () => ({ title: 'bad' }),
      ...def
    })
    assert.throws(
      () => f.execute(f.context, req({ command: name, idempotencyKey: name })),
      /constraint/i
    )
  }
  assert.deepEqual(counts(f.db), [1, 1])
  assert.equal(f.db.prepare('SELECT version FROM positions WHERE id=1').get().version, 1)
  assert.throws(() => f.register('bad', { aggregate: 'unknown' }), code('INVALID_AGGREGATE'))
})

test('DEV-04 rejects nested transactions, async services, unsafe versions and malformed JSON', (t) => {
  const f = setup(t)
  f.db.exec('BEGIN')
  assert.throws(() => f.execute(f.context, req()), code('NESTED_TRANSACTION'))
  assert(f.db.isTransaction)
  f.db.exec('ROLLBACK')
  for (const [name, change] of [
    ['async', async () => ({ title: 'bad' })],
    ['promise', () => Promise.resolve({ title: 'bad' })],
    ['version', () => ({ version: 50 })]
  ]) {
    f.register(name, { aggregate: 'position', eventType: 'position_updated', change })
    assert.throws(
      () => f.execute(f.context, req({ command: name })),
      code(name === 'version' ? 'INVALID_PATCH' : 'ASYNC_OPERATION')
    )
  }
  for (const v of [NaN, Infinity, undefined, new Date(), [, 1]])
    assert.throws(() => canonicalRequest(v), code('INVALID_REQUEST'))
  const cycle = {}
  cycle.a = cycle
  assert.throws(() => canonicalRequest(cycle), code('INVALID_REQUEST'))
  assert.equal(
    canonicalRequest({ z: 1, a: { d: 2, b: 3 } }),
    canonicalRequest({ a: { b: 3, d: 2 }, z: 1 })
  )
  assert.throws(
    () => f.execute(f.context, req({ expectedVersion: Number.MAX_SAFE_INTEGER })),
    code('INVALID_REQUEST')
  )
  assert.deepEqual(counts(f.db), [0, 0])
})

test('DEV-04 actual two-connection SQLite writer contention, replay and stale-version protection', async (t) => {
  const f = setup(t),
    root = createTestWorkspace(),
    file = path.join(root, 'commands.db')
  let a, b
  t.after(() => {
    if (a?.isOpen) a.close()
    if (b?.isOpen) b.close()
    removeTestWorkspace(root)
  })
  await sqlite.backup(f.db, file)
  a = new sqlite.DatabaseSync(file)
  b = new sqlite.DatabaseSync(file)
  for (const db of [a, b])
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=0')
  const ca = build(a),
    cb = build(b)
  a.exec('BEGIN IMMEDIATE')
  assert.throws(() => cb.execute(cb.context, req()), code('COMMAND_BUSY'))
  assert.deepEqual(counts(b), [0, 0])
  a.exec('ROLLBACK')
  const first = ca.execute(ca.context, req())
  const retry = cb.execute(cb.context, req())
  assert(retry.replayed)
  assert.deepEqual(retry.result, first.result)
  assert.throws(
    () => cb.execute(cb.context, req({ idempotencyKey: 'competing-key' })),
    code('VERSION_CONFLICT')
  )
  assert.deepEqual(counts(a), [1, 1])
  assert.equal(b.prepare('SELECT version FROM positions WHERE id=1').get().version, 2)
})
