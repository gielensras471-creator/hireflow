import { createFeedbackService } from '../server/services/feedback-service.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { decisionFixture, decisionCounts } from './helpers/decision-db.js'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import { createAdvancementService } from '../server/services/advancement-service.js'
import { createCommandCore } from '../server/services/command-core.js'

test('DEV-07 screening and evaluated rounds advance only in order; negative recommendations do not veto HR', (t) => {
  const f = decisionFixture(t)
  f.db.exec("UPDATE candidates SET stage='screening' WHERE id=1")
  f.advance()
  assert.equal(f.db.prepare('SELECT stage FROM candidates').get().stage, 'first_interview')
  assert.deepEqual(decisionCounts(f.db), [0, 1, 1, 0])
  for (const [stage, next] of [
    ['first_interview', 'second_interview'],
    ['second_interview', 'offer']
  ]) {
    const i = f.interview(f.candidateId, { stage_scope: stage })
    f.submit(i, { recommendation: 'not_recommend' })
    const pre = f.advancement.preflight(f.context, f.candidateId)
    assert(pre.canAdvance)
    assert.equal(pre.reasonType, null)
    assert.equal(pre.completed[0].recommendation, 'not_recommend')
    const r = f.advance(),
      event = f.db
        .prepare('SELECT * FROM business_events WHERE command_id=?')
        .get(r.result.commandId)
    assert.equal(JSON.parse(event.old_values_json).stage, stage)
    assert.equal(JSON.parse(event.new_values_json).stage, next)
    assert.equal(JSON.parse(event.context_json).kind, 'normal')
  }
  const row = f.db.prepare('SELECT * FROM candidates').get()
  assert.equal(row.stage, 'offer')
  assert.equal(row.offer_status, 'preparing')
  assert.equal(row.application_status, 'active')
  assert.equal(row.outcome, null)
  assert.equal(row.closed_reason, null)
  assert.equal(row.closed_at, null)
  assert.throws(
    () => f.advance(),
    (e) => e.code === 'NO_NEXT_STAGE'
  )
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM business_events WHERE event_type='stage_advanced'").get()
      .n,
    3
  )
})

test('DEV-07 missing list contains current completed/unrated only; exception history stays immutable across advancement', (t) => {
  const f = decisionFixture(t),
    missing = f.interview(f.candidateId),
    rated = f.interview(f.candidateId)
  f.submit(rated)
  f.interview(f.candidateId, {
    status: 'cancelled',
    completed_at: null,
    cancelled_at: 2,
    cancel_reason: 'Test'
  })
  f.interview(f.candidateId, { stage_scope: 'second_interview' })
  const pre = f.advancement.preflight(f.context, f.candidateId)
  assert.deepEqual(pre.missingInterviewIds, [missing])
  assert.equal(pre.completedCount, 2)
  assert.equal(pre.reasonType, 'missing_feedback')
  for (const reason of [undefined, '', ' '])
    assert.throws(
      () => f.advance(reason === undefined ? {} : { reason }),
      (e) =>
        e.code === 'ADVANCEMENT_REASON_REQUIRED' && e.details.missingInterviewIds[0] === missing
    )
  const r = f.advance({ reason: 'HR reviewed missing evidence' }),
    history = f.advancement.history(f.context, f.candidateId)
  assert.equal(
    history[0].id,
    f.db.prepare('SELECT id FROM business_events WHERE command_id=?').get(r.result.commandId).id
  )
  assert.deepEqual(
    history[0].missing.map((i) => ({ ...i })),
    [{ interview_id: missing, stage_scope: 'first_interview' }]
  )
  assert.deepEqual(history[0].context.missingInterviews, [
    { interviewId: missing, stageScope: 'first_interview' }
  ])
  assert.equal(history[0].reason, 'HR reviewed missing evidence')
  assert.equal(history[0].context.kind, 'missing_feedback')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM feedback').get().n, 1)
  assert.throws(
    () => f.submit(missing),
    (e) => e.code === 'HISTORICAL_FEEDBACK_NOT_ALLOWED'
  )
  assert.deepEqual(f.advancement.history(f.context, f.candidateId), history)
  assert.throws(() => f.db.exec('DELETE FROM advancement_missing_feedback'), /immutable/)
  assert.throws(() => f.db.exec("UPDATE business_events SET reason='changed'"), /immutable/)
})

test('DEV-07 cancelled/no interviews require skip rationale without fabricated missing facts; screening requires none', (t) => {
  for (const cancelled of [false, true]) {
    const f = decisionFixture(t)
    if (cancelled)
      f.interview(f.candidateId, {
        status: 'cancelled',
        completed_at: null,
        cancelled_at: 2,
        cancel_reason: 'Test'
      })
    assert.equal(f.advancement.preflight(f.context, f.candidateId).reasonType, 'skip_evaluation')
    assert.throws(
      () => f.advance(),
      (e) => e.code === 'ADVANCEMENT_REASON_REQUIRED'
    )
    f.advance({ reason: 'Skip this round assessment' })
    const event = f.advancement.history(f.context, f.candidateId)[0]
    assert.equal(event.context.kind, 'skip_evaluation')
    assert.deepEqual(event.context.missingInterviews, [])
    assert.deepEqual(event.missing, [])
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM feedback').get().n, 0)
  }
})

test('DEV-07 final execution rechecks preflight; pending appointment cannot be waived and old round does not block current', (t) => {
  const f = decisionFixture(t),
    i = f.interview(f.candidateId)
  f.submit(i)
  assert(f.advancement.preflight(f.context, f.candidateId).canAdvance)
  const pending = f.interview(f.candidateId, { status: 'scheduled', completed_at: null })
  assert.throws(
    () => f.advance({ reason: 'Cannot override' }),
    (e) => e.code === 'SCHEDULED_INTERVIEW_PENDING'
  )
  f.db
    .prepare(
      "UPDATE interviews SET status='cancelled',cancelled_at=2,cancel_reason='Fixture' WHERE id=?"
    )
    .run(pending)
  f.interview(f.candidateId, {
    stage_scope: 'second_interview',
    status: 'scheduled',
    completed_at: null
  })
  assert(f.advancement.preflight(f.context, f.candidateId).canAdvance)
  f.advance()
  assert.equal(
    f.advancement.preflight(f.context, f.candidateId).blockedReason,
    'SCHEDULED_INTERVIEW_PENDING'
  )
})

test('DEV-07 refuses jumps, rollback, closed/forged/unauthorized commands and stale versions; replay never advances twice', (t) => {
  const f = decisionFixture(t)
  for (const target_stage of ['screening', 'offer', 'bad'])
    assert.throws(
      () => f.advance({ target_stage, reason: 'Test' }),
      (e) => e.code === 'INVALID_STAGE_TRANSITION'
    )
  for (const extra of [
    { missingInterviewIds: [] },
    { canAdvance: true },
    { actor_user_id: 1 },
    { offer_status: 'accepted' }
  ])
    assert.throws(
      () => f.advance(extra),
      (e) => e.code === 'INVALID_FIELDS'
    )
  assert.throws(
    () => f.advancement.preflight({}, f.candidateId),
    (e) => e.code === 'INVALID_ACTOR'
  )
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  assert.throws(
    () => f.advance({ reason: 'Test' }),
    (e) => e.code === 'FORBIDDEN'
  )
  f.db.exec("UPDATE users SET role='hr' WHERE id=1")
  const request = f.request('application.advance', { reason: 'Skip evaluation' }),
    r = f.advancement.execute(f.context, request)
  assert.deepEqual(f.advancement.execute(f.context, request).result, r.result)
  assert.throws(
    () => f.advancement.execute(f.context, { ...request, payload: { reason: 'Changed' } }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT'
  )
  assert.throws(
    () => f.advancement.execute(f.context, { ...request, idempotencyKey: 'different' }),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.equal(f.db.prepare('SELECT stage FROM candidates').get().stage, 'second_interview')
  f.db.exec(
    "UPDATE candidates SET application_status='closed',outcome='company_rejected',closed_reason='Test',closed_at=2 WHERE id=1"
  )
  assert.throws(
    () => f.advance({ reason: 'Test' }),
    (e) => e.code === 'APPLICATION_CLOSED'
  )
  assert.deepEqual(decisionCounts(f.db), [0, 1, 1, 0])
})

test('DEV-07 missing relation, receipt or event failure rolls back entire advancement; async hooks are rejected', (t) => {
  const f = decisionFixture(t)
  f.interview(f.candidateId)
  const before = { ...f.db.prepare('SELECT * FROM candidates').get() }
  for (const table of ['advancement_missing_feedback', 'command_receipts', 'business_events']) {
    f.db.exec(
      'CREATE TRIGGER fault BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'advance fault'); END"
    )
    assert.throws(() => f.advance({ reason: 'Test' }), /advance fault/)
    assert.deepEqual(decisionCounts(f.db), [0, 0, 0, 0])
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM candidates').get() }, before)
    f.db.exec('DROP TRIGGER fault')
  }
  const core = createCommandCore({ db: f.db, resolveActor: () => 1, authorize: () => true })
  for (const [name, afterEvent] of [
    ['async', async () => {}],
    ['promise', () => Promise.resolve()],
    [
      'throws',
      () => {
        throw Error('hook fault')
      }
    ]
  ]) {
    core.register(name, {
      aggregate: 'candidate',
      eventType: 'candidate_updated',
      change: () => ({ note: 'Would roll back' }),
      afterEvent
    })
    assert.throws(
      () => core.execute(f.context, f.request(name, {})),
      (e) => e.code === 'ASYNC_OPERATION' || e.message === 'hook fault'
    )
    assert.deepEqual(decisionCounts(f.db), [0, 0, 0, 0])
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM candidates').get() }, before)
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})

test('DEV-07 actual two-connection write competition cannot double-advance or duplicate Feedback', async (t) => {
  const f = decisionFixture(t),
    root = createTestWorkspace(),
    file = path.join(root, 'decisions.db')
  let a, b
  t.after(() => {
    if (a?.isOpen) a.close()
    if (b?.isOpen) b.close()
    removeTestWorkspace(root)
  })
  const completed = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  await sqlite.backup(f.db, file)
  a = new sqlite.DatabaseSync(file)
  b = new sqlite.DatabaseSync(file)
  for (const db of [a, b])
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=0')
  const options = (db) => ({ db, resolveActor: (c) => (c === f.context ? 1 : undefined) }),
    sa = createAdvancementService(options(a)),
    sb = createAdvancementService(options(b))
  const request = f.request('application.advance', { reason: 'Skip assessment' })
  a.exec('BEGIN IMMEDIATE')
  assert.throws(
    () => sb.execute(f.context, request),
    (e) => e.code === 'COMMAND_BUSY'
  )
  a.exec('ROLLBACK')
  const first = sa.execute(f.context, request)
  assert(sb.execute(f.context, request).replayed)
  assert.throws(
    () => sb.execute(f.context, { ...request, idempotencyKey: 'competing' }),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.equal(first.result.version, 2)
  assert.equal(b.prepare('SELECT stage FROM candidates').get().stage, 'second_interview')
  assert.deepEqual(decisionCounts(b), [0, 1, 1, 0])
  const fa = createFeedbackService(options(a)),
    fb = createFeedbackService(options(b))
  const submit = {
    command: 'feedback.submit',
    aggregateId: f.candidateId,
    expectedVersion: 2,
    idempotencyKey: 'feedback-race',
    payload: {
      interview_id: completed,
      reviewer_name: 'Reviewer',
      recommendation: 'undecided',
      reason: 'Actual evidence'
    }
  }
  a.exec('BEGIN IMMEDIATE')
  assert.throws(
    () => fb.execute(f.context, submit),
    (e) => e.code === 'COMMAND_BUSY'
  )
  a.exec('ROLLBACK')
  fa.execute(f.context, submit)
  assert(fb.execute(f.context, submit).replayed)
  assert.throws(
    () => fb.execute(f.context, { ...submit, idempotencyKey: 'competing-feedback' }),
    (e) => e.code === 'VERSION_CONFLICT'
  )
  assert.throws(
    () =>
      fb.execute(f.context, { ...submit, expectedVersion: 3, idempotencyKey: 'another-feedback' }),
    (e) => e.code === 'FEEDBACK_ALREADY_EXISTS'
  )
  assert.deepEqual(decisionCounts(b), [1, 2, 2, 0])
  assert.deepEqual(b.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(b.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})
