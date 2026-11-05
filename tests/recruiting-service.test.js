import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/v3-db.js'
import { createRecruitingService } from '../server/services/recruiting-service.js'
const position = {
  title: 'Same',
  department: 'Test',
  location: 'Test',
  publish_date: '2026-11-03',
  description: 'Fictional'
}
const application = (position_id) => ({
  position_id,
  name: 'Same fictional person',
  owner: 'Business owner',
  applied_date: '2026-11-03',
  email: 'test@example.invalid'
})
const setup = (t) => {
  const f = fixture(t)
  f.db.exec("UPDATE users SET role='招聘管理员' WHERE id=1")
  const context = {},
    sessions = new WeakMap([[context, 1]])
  const service = createRecruitingService({ db: f.db, resolveActor: (c) => sessions.get(c) })
  let key = 0
  const run = (command, payload, aggregateId, expectedVersion, extra = {}) =>
    service.execute(context, {
      command,
      payload,
      idempotencyKey: 'key-' + ++key,
      ...(aggregateId === undefined ? {} : { aggregateId, expectedVersion }),
      ...extra
    })
  return { ...f, context, sessions, service, run }
}
const audit = (db) =>
  ['business_events', 'command_receipts'].map(
    (t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n
  )

test('DEV-05 creates positions and independent applications with server identity/defaults, count and stable ID joins', (t) => {
  const f = setup(t),
    a = f.run('position.create', position).result,
    b = f.run('position.create', position).result
  const x = f.run('application.create', application(a.aggregateId)).result,
    y = f.run('application.create', application(b.aggregateId)).result
  assert.notEqual(a.aggregateId, b.aggregateId)
  assert.notEqual(x.aggregateId, y.aggregateId)
  const rows = f.service.applications(f.context)
  assert.equal(rows.length, 2)
  for (const c of rows) {
    assert.equal(c.stage, 'screening')
    assert.equal(c.application_status, 'active')
    assert.equal(c.version, 1)
    assert.equal(c.outcome, null)
    assert.equal(c.offer_status, null)
    assert.equal(c.closed_at, null)
    assert.equal(c.closed_reason, null)
    assert(c.created_at > 0)
  }
  const old = f.db
    .prepare('SELECT new_values_json FROM business_events WHERE command_id=?')
    .get(a.commandId).new_values_json
  f.run('position.update', { title: 'Renamed' }, a.aggregateId, 1)
  assert.equal(
    f.service.applications(f.context).find((c) => c.id === x.aggregateId).position_id,
    a.aggregateId
  )
  assert.equal(
    f.service.applications(f.context).find((c) => c.id === x.aggregateId).position_title,
    'Renamed'
  )
  assert.equal(
    f.db.prepare('SELECT new_values_json FROM business_events WHERE command_id=?').get(a.commandId)
      .new_values_json,
    old
  )
  assert.equal(f.service.positionDetail(f.context, a.aggregateId).applicationRecords, 1)
  assert.equal(
    f.db.prepare('SELECT actor_name_snapshot FROM business_events LIMIT 1').get()
      .actor_name_snapshot,
    'Test HR'
  )
  assert.equal(
    JSON.parse(
      f.db.prepare('SELECT old_values_json FROM business_events LIMIT 1').get().old_values_json
    ),
    null
  )
})

test('DEV-05 explicit HR whitelist and authenticated sensitive reads reject forged or invalid identity', (t) => {
  const f = setup(t)
  for (const role of ['招聘管理员', 'hr', 'admin']) {
    f.db.prepare('UPDATE users SET role=? WHERE id=1').run(role)
    f.run('position.create', position)
  }
  const before = audit(f.db)
  for (const role of ['interviewer', 'unknown', 'HR', '', '招聘管理员 ']) {
    f.db.prepare('UPDATE users SET role=? WHERE id=1').run(role)
    assert.throws(
      () => f.run('position.create', position),
      (e) => e.code === 'FORBIDDEN'
    )
    assert.throws(
      () => f.service.applications(f.context),
      (e) => e.code === 'FORBIDDEN'
    )
  }
  assert.deepEqual(audit(f.db), before)
  for (const query of ['positions', 'positionOptions', 'applications'])
    assert.throws(
      () => f.service[query]({}),
      (e) => e.code === 'INVALID_ACTOR'
    )
  f.sessions.set(f.context, 999)
  assert.throws(
    () => f.run('position.create', position),
    (e) => e.code === 'INVALID_ACTOR'
  )
  f.sessions.set(f.context, '1')
  assert.throws(
    () => f.run('position.create', position),
    (e) => e.code === 'INVALID_ACTOR'
  )
})

test('DEV-05 close/reopen and soft-delete retain applications, old references and risk warnings', (t) => {
  const f = setup(t),
    id = f.firstPosition
  f.run('application.create', application(id))
  f.run('application.create', application(id))
  f.db.exec(
    "UPDATE candidates SET application_status='closed',outcome='company_rejected',closed_reason='Fixture',closed_at=created_at WHERE id=2"
  )
  f.legacy({ mapping_status: 'unique_match', mapped_position_id: id })
  const closed = f.run('position.status', { status: 'closed' }, id, 1)
  assert.deepEqual(closed.risk, {
    applicationRecords: 2,
    activeApplications: 1,
    legacyReferences: 1,
    warning: 'POSITION_HAS_ACTIVE_APPLICATIONS'
  })
  assert.equal(f.service.applications(f.context)[0].application_status, 'active')
  assert.throws(
    () => f.run('application.create', application(id)),
    (e) => e.code === 'POSITION_NOT_OPEN'
  )
  f.run('position.status', { status: 'open' }, id, 2)
  const deleted = f.run('position.delete', {}, id, 3)
  assert.equal(deleted.risk.deletion, 'soft')
  assert.equal(deleted.risk.legacyReferences, 1)
  assert.equal(f.service.positionDetail(f.context, id).applicationRecords, 2)
  assert.equal(f.service.positionOptions(f.context).length, 0)
  assert.throws(
    () => f.run('application.create', application(id)),
    (e) => e.code === 'POSITION_NOT_OPEN'
  )
  assert.throws(
    () => f.run('position.status', { status: 'open' }, id, 4),
    (e) => e.code === 'POSITION_DELETED'
  )
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM legacy_records').get().n, 1)
})

test('DEV-05 create retry is idempotent even after position closes; changed content conflicts', (t) => {
  const f = setup(t),
    payload = application(f.firstPosition)
  const a = f.run('application.create', payload, undefined, undefined, { idempotencyKey: 'same' })
  f.run('position.status', { status: 'closed' }, f.firstPosition, 1)
  const b = f.run('application.create', payload, undefined, undefined, { idempotencyKey: 'same' })
  assert(b.replayed)
  assert.deepEqual(a.result, b.result)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 1)
  assert.throws(
    () =>
      f.run('application.create', { ...payload, name: 'Changed' }, undefined, undefined, {
        idempotencyKey: 'same'
      }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT'
  )
  const p = f.run('position.create', position, undefined, undefined, { idempotencyKey: 'position' })
  assert(
    f.run('position.create', position, undefined, undefined, { idempotencyKey: 'position' })
      .replayed
  )
  assert.equal(f.service.positions(f.context).length, 2)
  assert.equal(p.result.version, 1)
})

test('DEV-05 rejects forged audit, creation state/IDs/time, reassignment and ordinary state edits', (t) => {
  const f = setup(t),
    base = application(f.firstPosition)
  for (const [k, v] of Object.entries({
    stage: 'offer',
    application_status: 'closed',
    outcome: 'hired',
    offer_status: 'accepted',
    id: 99,
    version: 50,
    created_at: 1,
    closed_at: 1,
    closed_reason: 'fake',
    actor_user_id: 2,
    actor_name_snapshot: 'fake',
    role: 'admin',
    event_type: 'candidate_hired'
  }))
    assert.throws(() => f.run('application.create', { ...base, [k]: v }))
  const id = f.run('application.create', base).result.aggregateId
  for (const k of [
    'position_id',
    'stage',
    'application_status',
    'outcome',
    'offer_status',
    'closed_at',
    'closed_reason'
  ])
    assert.throws(() =>
      f.run('application.update', { [k]: k === 'position_id' ? 999 : 'fake' }, id, 1)
    )
  f.run('application.update', { note: 'Reviewed', owner: 'Different business owner' }, id, 1)
  assert.throws(
    () => f.run('application.update', { note: 'stale' }, id, 1),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.throws(() =>
    f.service.execute(f.context, {
      command: 'position.create',
      payload: position,
      idempotencyKey: 'forged',
      actor_user_id: 99
    })
  )
  assert.throws(
    () => f.run('position.create', position, 99, 1),
    (e) => e.code === 'INVALID_REQUEST'
  )
})

test('DEV-05 validates input fields, dates, contacts and stable position ID', (t) => {
  const f = setup(t),
    base = application(f.firstPosition)
  for (const p of [
    { ...base, name: '' },
    { ...base, owner: ' ' },
    { ...base, applied_date: '2026-02-30' },
    { ...base, phone: 123 },
    { ...base, email: 'bad' },
    { ...base, position_id: '1' },
    { ...base, position_id: 999 },
    { name: 'Missing' }
  ])
    assert.throws(() => f.run('application.create', p))
  for (const p of [
    { ...position, publish_date: 'bad' },
    { ...position, title: '' },
    { ...position, department: 3 },
    { ...position, candidate_count: 999 }
  ])
    assert.throws(() => f.run('position.create', p))
  assert.deepEqual(audit(f.db), [0, 0])
})

test('DEV-05 creation and modification rollback on event or receipt failures', (t) => {
  const f = setup(t)
  for (const table of ['command_receipts', 'business_events']) {
    const before = audit(f.db)
    f.db.exec(
      'CREATE TRIGGER fault BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'DEV05 fault'); END"
    )
    for (const [command, payload, id, version] of [
      ['position.create', position],
      ['application.create', application(f.firstPosition)],
      ['position.update', { title: 'bad' }, f.firstPosition, 1]
    ])
      assert.throws(() => f.run(command, payload, id, version), /DEV05 fault/)
    assert.equal(f.service.positions(f.context).length, 1)
    assert.equal(f.service.applications(f.context).length, 0)
    assert.equal(f.service.positionDetail(f.context, f.firstPosition).version, 1)
    assert.deepEqual(audit(f.db), before)
    f.db.exec('DROP TRIGGER fault')
  }
})

test('DEV-05 actual competing connection cannot create through an in-flight position closure', async (t) => {
  const f = setup(t),
    root = createTestWorkspace(),
    file = path.join(root, 'recruiting.db')
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
  const context = {},
    service = createRecruitingService({
      db: b,
      resolveActor: (c) => (c === context ? 1 : undefined)
    })
  const request = {
    command: 'application.create',
    payload: application(1),
    idempotencyKey: 'competing-create'
  }
  a.exec("BEGIN IMMEDIATE; UPDATE positions SET status='closed',version=version+1 WHERE id=1")
  assert.throws(
    () => service.execute(context, request),
    (e) => e.code === 'COMMAND_BUSY'
  )
  a.exec('COMMIT')
  assert.throws(
    () => service.execute(context, request),
    (e) => e.code === 'POSITION_NOT_OPEN'
  )
  assert.deepEqual(audit(b), [0, 0])
  assert.equal(b.prepare('SELECT COUNT(*) n FROM candidates').get().n, 0)
})

test('DEV-05-FIX-01 unchanged status and profiles reject without versions, events or receipts', (t) => {
  const f = setup(t),
    id = f.firstPosition
  const applicationId = f.run('application.create', application(id)).result.aggregateId
  const unchanged = (command, payload, aggregateId, expectedVersion) => {
    const before = audit(f.db)
    const table = command.startsWith('position.') ? 'positions' : 'candidates'
    const row = { ...f.db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(aggregateId) }
    for (const key of ['noop-one-' + command, 'noop-two-' + command])
      assert.throws(
        () => f.run(command, payload, aggregateId, expectedVersion, { idempotencyKey: key }),
        (e) => e.code === 'NO_CHANGE'
      )
    assert.deepEqual(audit(f.db), before)
    assert.deepEqual(
      { ...f.db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(aggregateId) },
      row
    )
  }
  unchanged('position.status', { status: 'open' }, id, 1)
  unchanged('position.update', { title: 'Same title', department: 'Test' }, id, 1)
  unchanged(
    'application.update',
    { name: 'Same fictional person', owner: 'Business owner' },
    applicationId,
    1
  )
  unchanged('position.update', {}, id, 1)
  f.run('position.status', { status: 'closed' }, id, 1)
  unchanged('position.status', { status: 'closed' }, id, 2)
})

test('DEV-05-FIX-01 partial changes commit; replay precedes NO_CHANGE for all three updates', (t) => {
  const f = setup(t),
    id = f.firstPosition
  const applicationId = f.run('application.create', application(id)).result.aggregateId
  for (const [command, payload, aggregateId, version, key] of [
    ['position.update', { title: 'Same title', department: 'Changed' }, id, 1, 'profile'],
    ['position.status', { status: 'closed' }, id, 2, 'status'],
    [
      'application.update',
      { name: 'Same fictional person', owner: 'New owner', note: 'New note' },
      applicationId,
      1,
      'application'
    ]
  ]) {
    const before = audit(f.db)
    const first = f.run(command, payload, aggregateId, version, { idempotencyKey: key })
    assert.equal(first.result.version, version + 1)
    assert.deepEqual(
      audit(f.db),
      before.map((n) => n + 1)
    )
    const retry = f.run(command, payload, aggregateId, version, { idempotencyKey: key })
    assert(retry.replayed)
    assert.deepEqual(retry.result, first.result)
    const committed = audit(f.db)
    assert.throws(
      () => f.run(command, payload, aggregateId, version + 1, { idempotencyKey: key + '-new' }),
      (e) => e.code === 'NO_CHANGE'
    )
    assert.deepEqual(audit(f.db), committed)
  }
})
