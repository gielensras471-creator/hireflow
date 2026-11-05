import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { fixture } from './helpers/v3-db.js'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import {
  createInterviewService,
  parseShanghaiDateTime
} from '../server/services/interview-service.js'
const when = '2026-11-05T14:00:00'
const schedule = { scheduled_at: when, interviewer_name: 'Professional Reviewer' }
const audit = (db) =>
  ['interviews', 'business_events', 'command_receipts', 'feedback'].map(
    (t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n
  )
const setup = (t) => {
  const f = fixture(t)
  f.db.exec("UPDATE users SET role='招聘管理员' WHERE id=1")
  const candidateId = f.candidate(),
    context = {},
    sessions = new WeakMap([[context, 1]])
  let time = parseShanghaiDateTime(when) - 1000,
    key = 0
  const service = createInterviewService({
    db: f.db,
    resolveActor: (c) => sessions.get(c),
    clock: () => time
  })
  const version = () =>
    f.db.prepare('SELECT version FROM candidates WHERE id=?').get(candidateId).version
  const run = (action, payload, extra = {}) =>
    service.execute(context, {
      command: 'interview.' + action,
      aggregateId: candidateId,
      expectedVersion: version(),
      idempotencyKey: 'interview-' + ++key,
      payload,
      ...extra
    })
  return {
    ...f,
    candidateId,
    context,
    sessions,
    service,
    run,
    version,
    setTime: (x) => {
      time = x
    }
  }
}
const item = (result, more = {}) => ({
  interview_id: result.result.interviewId,
  interview_version: result.result.interviewVersion,
  ...more
})

test('DEV-06 stage-scoped scheduling has truthful interview snapshots, actor and aggregate/record versions', (t) => {
  const f = setup(t)
  for (const stage of ['first_interview', 'second_interview']) {
    if (stage === 'second_interview')
      f.db.prepare('UPDATE candidates SET stage=? WHERE id=?').run(stage, f.candidateId)
    const before = { ...f.db.prepare('SELECT * FROM candidates WHERE id=?').get(f.candidateId) }
    const r = f.run('schedule', schedule),
      row = f.service.detail(f.context, r.result.interviewId)
    assert.equal(row.stage_scope, stage)
    assert.equal(row.status, 'scheduled')
    assert.equal(row.version, 1)
    assert.equal(row.completed_at, null)
    assert.equal(row.cancelled_at, null)
    assert.equal(row.cancel_reason, null)
    const event = f.db
      .prepare('SELECT * FROM business_events WHERE command_id=?')
      .get(r.result.commandId)
    assert.equal(event.aggregate_type, 'candidate')
    assert.equal(event.candidate_id, f.candidateId)
    assert.equal(event.interview_id, row.id)
    assert.equal(event.aggregate_version, before.version + 1)
    assert.equal(event.actor_name_snapshot, 'Test HR')
    assert.equal(event.actor_user_id, 1)
    assert.equal(JSON.parse(event.old_values_json), null)
    assert.deepEqual(JSON.parse(event.new_values_json), {
      ...f.db.prepare('SELECT * FROM interviews WHERE id=?').get(row.id)
    })
    assert.deepEqual(
      { ...f.db.prepare('SELECT * FROM candidates WHERE id=?').get(f.candidateId) },
      { ...before, version: before.version + 1 }
    )
    assert.throws(
      () => f.run('schedule', schedule),
      (e) => e.code === 'INTERVIEW_ALREADY_SCHEDULED'
    )
    f.run('complete', item(r))
  }
  assert.deepEqual(audit(f.db), [2, 4, 4, 0])
  const versions = f.db
    .prepare('SELECT aggregate_version FROM business_events ORDER BY id')
    .all()
    .map((r) => r.aggregate_version)
  assert.deepEqual(versions, [2, 3, 4, 5])
})

test('DEV-06 screening, offer and closed applications cannot schedule; closed guards every ordinary operation', (t) => {
  const f = setup(t)
  for (const [stage, status, outcome, offer] of [
    ['screening', 'active', null, null],
    ['offer', 'active', null, 'preparing'],
    ['first_interview', 'closed', 'company_rejected', null]
  ]) {
    f.db
      .prepare(
        'UPDATE candidates SET stage=?,application_status=?,outcome=?,offer_status=?,closed_reason=?,closed_at=? WHERE id=?'
      )
      .run(
        stage,
        status,
        outcome,
        offer,
        status === 'closed' ? 'Fixture' : null,
        status === 'closed' ? 2 : null,
        f.candidateId
      )
    assert.throws(() => f.run('schedule', schedule), /INVALID_INTERVIEW_STAGE|APPLICATION_CLOSED/)
  }
  assert.deepEqual(audit(f.db), [0, 0, 0, 0])
  f.db
    .prepare(
      "UPDATE candidates SET application_status='active',outcome=NULL,closed_reason=NULL,closed_at=NULL WHERE id=?"
    )
    .run(f.candidateId)
  const r = f.run('schedule', schedule)
  f.db
    .prepare(
      "UPDATE candidates SET application_status='closed',outcome='company_rejected',closed_reason='Fixture',closed_at=2 WHERE id=?"
    )
    .run(f.candidateId)
  for (const [action, p] of [
    ['reschedule', { scheduled_at: '2026-11-06T14:00:00' }],
    ['complete', {}],
    ['cancel', { reason: 'Fixture' }]
  ])
    assert.throws(
      () => f.run(action, item(r, p)),
      (e) => e.code === 'APPLICATION_CLOSED'
    )
  assert.deepEqual(audit(f.db), [1, 1, 1, 0])
})

test('DEV-06 rescheduling changes existing interview only, preserves snapshots and rejects NO_CHANGE', (t) => {
  const f = setup(t),
    r = f.run('schedule', schedule),
    before = { ...f.db.prepare('SELECT * FROM interviews').get() }
  assert.throws(
    () => f.run('reschedule', item(r, { scheduled_at: when })),
    (e) => e.code === 'NO_CHANGE'
  )
  const newer = f.run('reschedule', item(r, { scheduled_at: '2026-11-06T15:30:00+08:00' }))
  const e = f.db
    .prepare("SELECT * FROM business_events WHERE event_type='interview_rescheduled'")
    .get()
  assert.deepEqual(JSON.parse(e.old_values_json), before)
  assert.equal(
    JSON.parse(e.new_values_json).scheduled_at,
    parseShanghaiDateTime('2026-11-06T15:30:00')
  )
  assert.equal(newer.result.interviewVersion, 2)
  assert.equal(newer.result.version, 3)
  assert.equal(f.db.prepare('SELECT stage FROM candidates').get().stage, 'first_interview')
  assert.deepEqual(audit(f.db), [1, 2, 2, 0])
})

test('DEV-06 completion and reasoned cancellation do not advance/close applications; sequential interviews allowed', (t) => {
  const f = setup(t)
  for (const action of ['complete', 'cancel']) {
    const r = f.run('schedule', schedule)
    if (action === 'cancel')
      for (const reason of ['', ' ', null])
        assert.throws(
          () => f.run(action, item(r, { reason })),
          (e) => e.code === 'CANCEL_REASON_REQUIRED'
        )
    const start = Date.now(),
      done = f.run(action, item(r, action === 'cancel' ? { reason: 'Actual cancellation' } : {})),
      row = f.service.detail(f.context, r.result.interviewId)
    assert.equal(row.status, action === 'complete' ? 'completed' : 'cancelled')
    assert(row[action === 'complete' ? 'completed_at' : 'cancelled_at'] >= start)
    assert.equal(row[action === 'complete' ? 'cancelled_at' : 'completed_at'], null)
    assert.equal(row.cancel_reason, action === 'complete' ? null : 'Actual cancellation')
    const candidate = f.db.prepare('SELECT * FROM candidates').get()
    assert.equal(candidate.stage, 'first_interview')
    assert.equal(candidate.outcome, null)
    assert.equal(candidate.application_status, 'active')
    for (const [op, p] of [
      ['reschedule', { scheduled_at: '2026-11-07T14:00:00' }],
      ['complete', {}],
      ['cancel', { reason: 'Again' }]
    ])
      assert.throws(
        () => f.run(op, item(done, p)),
        (e) => e.code === 'INTERVIEW_NOT_SCHEDULED'
      )
  }
  assert.equal(f.service.byApplication(f.context, f.candidateId).length, 2)
  assert.deepEqual(audit(f.db), [2, 4, 4, 0])
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})

test('DEV-06 idempotency precedes terminal/closed checks; both versions reject stale commands', (t) => {
  const f = setup(t),
    request = {
      command: 'interview.schedule',
      aggregateId: f.candidateId,
      expectedVersion: 1,
      idempotencyKey: 'stable',
      payload: schedule
    }
  const r = f.service.execute(f.context, request)
  assert(f.service.execute(f.context, request).replayed)
  assert.throws(
    () => f.service.execute(f.context, { ...request, payload: { ...schedule, note: 'Changed' } }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT'
  )
  assert.throws(
    () => f.run('complete', item(r), { expectedVersion: 1 }),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.throws(
    () => f.run('complete', item(r, { interview_version: 99 })),
    (e) => e.code === 'INTERVIEW_VERSION_CONFLICT'
  )
  const complete = {
    command: 'interview.complete',
    aggregateId: f.candidateId,
    expectedVersion: 2,
    idempotencyKey: 'done',
    payload: item(r)
  }
  const result = f.service.execute(f.context, complete)
  assert.deepEqual(f.service.execute(f.context, complete).result, result.result)
  f.db
    .prepare(
      "UPDATE candidates SET application_status='closed',outcome='company_rejected',closed_reason='Fixture',closed_at=2 WHERE id=?"
    )
    .run(f.candidateId)
  assert(f.service.execute(f.context, request).replayed)
  assert.deepEqual(audit(f.db), [1, 2, 2, 0])
})

test('DEV-06 rejects forged identity, immutable ownership/scope, invalid input and cross-application links', (t) => {
  const f = setup(t)
  for (const p of [
    { ...schedule, stage_scope: 'second_interview' },
    { ...schedule, candidate_id: 2 },
    { ...schedule, status: 'completed' },
    { ...schedule, created_at: 1 },
    { ...schedule, interviewer_name: '' },
    { ...schedule, scheduled_at: 'bad' }
  ])
    assert.throws(() => f.run('schedule', p))
  assert.throws(
    () => f.service.list({}),
    (e) => e.code === 'INVALID_ACTOR'
  )
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  assert.throws(
    () => f.run('schedule', schedule),
    (e) => e.code === 'FORBIDDEN'
  )
  f.db.exec("UPDATE users SET role='hr' WHERE id=1")
  const r = f.run('schedule', schedule),
    other = f.candidate(),
    j = f.interview(other, { status: 'scheduled', completed_at: null })
  assert.throws(
    () => f.run('complete', { interview_id: j, interview_version: 1 }),
    (e) => e.code === 'INTERVIEW_ASSOCIATION_CONFLICT'
  )
  for (const p of [
    { candidate_id: other },
    { stage_scope: 'second_interview' },
    { status: 'cancelled' },
    { actor_user_id: 1 }
  ])
    assert.throws(
      () => f.run('complete', item(r, p)),
      (e) => e.code === 'INVALID_FIELDS'
    )
  f.sessions.set(f.context, 999)
  assert.throws(
    () => f.run('complete', item(r)),
    (e) => e.code === 'INVALID_ACTOR'
  )
  assert.deepEqual(audit(f.db), [2, 1, 1, 0])
})

test('DEV-06 event and receipt failure roll back inserted/updated interviews and aggregate version', (t) => {
  const f = setup(t)
  for (const table of ['command_receipts', 'business_events']) {
    f.db.exec(
      'CREATE TRIGGER fault BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'interview fault'); END"
    )
    assert.throws(() => f.run('schedule', schedule), /interview fault/)
    assert.deepEqual(audit(f.db), [0, 0, 0, 0])
    assert.equal(f.version(), 1)
    f.db.exec('DROP TRIGGER fault')
  }
  const r = f.run('schedule', schedule),
    before = { ...f.db.prepare('SELECT * FROM interviews').get() }
  for (const table of ['command_receipts', 'business_events']) {
    f.db.exec(
      'CREATE TRIGGER fault BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'interview fault'); END"
    )
    for (const [op, p] of [
      ['complete', {}],
      ['cancel', { reason: 'Fixture' }],
      ['reschedule', { scheduled_at: '2026-11-06T14:00:00' }]
    ])
      assert.throws(() => f.run(op, item(r, p)), /interview fault/)
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM interviews').get() }, before)
    assert.equal(f.version(), 2)
    assert.deepEqual(audit(f.db), [1, 1, 1, 0])
    f.db.exec('DROP TRIGGER fault')
  }
})

test('DEV-06 deterministic Shanghai parsing and 13:59:59/14:00:00/14:00:01 reminder boundary is read-only', (t) => {
  const f = setup(t),
    r = f.run('schedule', schedule),
    time = parseShanghaiDateTime(when)
  assert.equal(time, Date.parse('2026-11-05T06:00:00Z'))
  assert.equal(parseShanghaiDateTime(when + '+08:00'), time)
  for (const bad of [
    '2026-02-30T14:00:00',
    '2026-11-05T24:00:00',
    '2026-11-05T14:00:00Z',
    '2026-11-05',
    NaN,
    -1
  ])
    assert.throws(() => parseShanghaiDateTime(bad))
  const before = { ...f.db.prepare('SELECT * FROM interviews').get() },
    counts = audit(f.db)
  for (const [offset, due] of [
    [-1000, false],
    [0, true],
    [1000, true]
  ]) {
    f.setTime(time + offset)
    const row = f.service.detail(f.context, r.result.interviewId)
    assert.equal(row.start_time_reached, due)
    assert.equal(row.reminder, due ? '预约开始时间已到，待确认面试状态' : null)
    assert.equal(row.scheduled_local, when + '+08:00')
    assert.equal(row.status, 'scheduled')
  }
  assert.deepEqual(audit(f.db), counts)
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM interviews').get() }, before)
  const done = f.run('complete', item(r))
  assert.equal(f.service.detail(f.context, done.result.interviewId).reminder, null)
})

test('DEV-06 actual two-connection writer contention and single-scheduled invariant', async (t) => {
  const f = setup(t),
    root = createTestWorkspace(),
    file = path.join(root, 'interviews.db')
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
    make = (db) =>
      createInterviewService({ db, resolveActor: (c) => (c === context ? 1 : undefined) }),
    sa = make(a),
    sb = make(b)
  const request = {
    command: 'interview.schedule',
    aggregateId: f.candidateId,
    expectedVersion: 1,
    idempotencyKey: 'race',
    payload: schedule
  }
  a.exec('BEGIN IMMEDIATE')
  assert.throws(
    () => sb.execute(context, request),
    (e) => e.code === 'COMMAND_BUSY'
  )
  a.exec('ROLLBACK')
  const first = sa.execute(context, request)
  assert(sb.execute(context, request).replayed)
  assert.throws(
    () => sb.execute(context, { ...request, idempotencyKey: 'second' }),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.throws(
    () => sb.execute(context, { ...request, expectedVersion: 2, idempotencyKey: 'second' }),
    (e) => e.code === 'INTERVIEW_ALREADY_SCHEDULED'
  )
  assert.equal(b.prepare("SELECT COUNT(*) n FROM interviews WHERE status='scheduled'").get().n, 1)
  assert.equal(first.result.version, 2)
  assert.deepEqual(audit(b), [1, 1, 1, 0])
  assert.deepEqual(b.prepare('PRAGMA foreign_key_check').all(), [])
})

test('DEV-06-FIX-01 numeric milliseconds and strings share the four-digit Shanghai display range', (t) => {
  const f = setup(t),
    normal = Date.parse('2026-11-05T06:00:00Z')
  assert.equal(parseShanghaiDateTime(normal), normal)
  assert.equal(parseShanghaiDateTime(when), normal)
  assert.equal(parseShanghaiDateTime(when + '+08:00'), normal)
  const upper = Date.parse('9999-12-31T23:59:59.999+08:00')
  for (const [ms, display] of [
    [0, '1970-01-01T08:00:00+08:00'],
    [normal, when + '+08:00'],
    [normal + 123, when + '+08:00'],
    [upper, '9999-12-31T23:59:59+08:00']
  ]) {
    assert.equal(parseShanghaiDateTime(ms), ms)
    const r = f.run('schedule', { ...schedule, scheduled_at: ms })
    assert.equal(f.service.detail(f.context, r.result.interviewId).scheduled_local, display)
    assert.equal(
      f.service.list(f.context).find((row) => row.id === r.result.interviewId).scheduled_at,
      ms
    )
    f.run('cancel', item(r, { reason: 'Boundary fixture complete' }))
  }
  assert.equal(parseShanghaiDateTime('9999-12-31T23:59:59'), upper - 999)
  assert.equal(parseShanghaiDateTime('9999-12-31T23:59:59+08:00'), upper - 999)
  assert.throws(
    () => parseShanghaiDateTime(upper + 1),
    (e) => e.code === 'INVALID_TIME'
  )
})

test('DEV-06-FIX-01 overflow and expanded-year inputs reject atomically for scheduling and rescheduling', (t) => {
  const f = setup(t),
    invalid = [
      8640000000000000,
      8640000000000000 - 1,
      8640000000000000 - 4 * 3600000,
      Date.parse('+010000-01-01T00:00:00+08:00'),
      Date.parse('9999-12-31T23:59:59.999+08:00') + 1,
      '10000-01-01T00:00:00',
      Number.MAX_SAFE_INTEGER
    ]
  const candidate = { ...f.db.prepare('SELECT * FROM candidates WHERE id=?').get(f.candidateId) },
    before = audit(f.db)
  for (const value of invalid) {
    assert.throws(
      () => parseShanghaiDateTime(value),
      (e) => e.code === 'INVALID_TIME'
    )
    assert.throws(
      () => f.run('schedule', { ...schedule, scheduled_at: value }),
      (e) => e.code === 'INVALID_TIME'
    )
    assert.deepEqual(audit(f.db), before)
    assert.deepEqual(
      { ...f.db.prepare('SELECT * FROM candidates WHERE id=?').get(f.candidateId) },
      candidate
    )
  }
  const r = f.run('schedule', schedule),
    saved = { ...f.db.prepare('SELECT * FROM interviews').get() },
    committed = audit(f.db),
    version = f.version()
  for (const value of invalid) {
    assert.throws(
      () => f.run('reschedule', item(r, { scheduled_at: value })),
      (e) => e.code === 'INVALID_TIME'
    )
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM interviews').get() }, saved)
    assert.deepEqual(audit(f.db), committed)
    assert.equal(f.version(), version)
  }
})
