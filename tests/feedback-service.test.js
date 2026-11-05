import test from 'node:test'
import assert from 'node:assert/strict'
import { decisionFixture, decisionCounts } from './helpers/decision-db.js'

test('DEV-07 completed interviews accept all recommendations with real Feedback snapshots and distinct reviewer/HR', (t) => {
  const f = decisionFixture(t)
  for (const recommendation of ['recommend', 'not_recommend', 'undecided']) {
    const i = f.interview(f.candidateId),
      before = { ...f.db.prepare('SELECT * FROM candidates').get() },
      interview = { ...f.db.prepare('SELECT * FROM interviews WHERE id=?').get(i) },
      start = Date.now()
    const r = f.submit(i, { recommendation }),
      row = f.db.prepare('SELECT * FROM feedback WHERE id=?').get(r.result.feedbackId),
      event = f.db
        .prepare('SELECT * FROM business_events WHERE command_id=?')
        .get(r.result.commandId)
    assert.equal(row.recommendation, recommendation)
    assert.equal(row.recorded_by_user_id, 1)
    assert.equal(row.reviewer_name, 'Professional reviewer')
    assert.equal(row.revision, 1)
    assert(row.submitted_at >= start)
    assert.equal(event.feedback_id, row.id)
    assert.equal(event.interview_id, i)
    assert.equal(event.candidate_id, f.candidateId)
    assert.equal(event.event_type, 'feedback_submitted')
    assert.equal(event.actor_name_snapshot, 'Test HR')
    assert.equal(JSON.parse(event.old_values_json), null)
    assert.deepEqual(JSON.parse(event.new_values_json), { ...row })
    assert.deepEqual(
      { ...f.db.prepare('SELECT * FROM candidates WHERE id=?').get(f.candidateId) },
      { ...before, version: before.version + 1 }
    )
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM interviews WHERE id=?').get(i) }, interview)
    assert.throws(
      () => f.submit(i, { reviewer_name: 'Second reviewer' }),
      (e) => e.code === 'FEEDBACK_ALREADY_EXISTS'
    )
  }
  assert.equal(f.feedback.byApplication(f.context, f.candidateId).length, 3)
})

test('DEV-07 feedback rejects scheduled/cancelled, historical rounds, closed and cross-application records', (t) => {
  const f = decisionFixture(t)
  for (const values of [
    { status: 'scheduled', completed_at: null },
    { status: 'cancelled', completed_at: null, cancelled_at: 2, cancel_reason: 'Test' }
  ]) {
    const i = f.interview(f.candidateId, values)
    assert.throws(
      () => f.submit(i),
      (e) => e.code === 'INTERVIEW_NOT_COMPLETED'
    )
  }
  const old = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  assert.throws(
    () => f.submit(old),
    (e) => e.code === 'HISTORICAL_FEEDBACK_NOT_ALLOWED'
  )
  const other = f.candidate(),
    foreign = f.interview(other)
  assert.throws(
    () => f.submit(foreign),
    (e) => e.code === 'INTERVIEW_ASSOCIATION_CONFLICT'
  )
  const valid = f.interview(f.candidateId)
  f.db.exec(
    "UPDATE candidates SET application_status='closed',outcome='company_rejected',closed_reason='Fixture',closed_at=2 WHERE id=1"
  )
  assert.throws(
    () => f.submit(valid),
    (e) => e.code === 'APPLICATION_CLOSED'
  )
  assert.deepEqual(decisionCounts(f.db), [0, 0, 0, 0])
})

test('DEV-07 feedback fields/identity are validated and retries do not overwrite a first submission', (t) => {
  const f = decisionFixture(t),
    i = f.interview(f.candidateId)
  for (const extra of [
    { reviewer_name: '' },
    { reviewer_name: 3 },
    { reason: ' ' },
    { reason: false },
    { recommendation: 'pass' },
    ...['recorded_by_user_id', 'submitted_at', 'revision', 'id', 'actor_user_id', 'stage'].map(
      (k) => ({ [k]: 1 })
    )
  ])
    assert.throws(() => f.submit(i, extra))
  const request = f.request('feedback.submit', {
    interview_id: i,
    reviewer_name: 'Reviewer',
    recommendation: 'undecided',
    reason: 'Evidence'
  })
  assert.throws(
    () => f.feedback.execute({}, request),
    (e) => e.code === 'INVALID_ACTOR'
  )
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  assert.throws(
    () => f.feedback.execute(f.context, request),
    (e) => e.code === 'FORBIDDEN'
  )
  f.db.exec("UPDATE users SET role='hr' WHERE id=1")
  const result = f.feedback.execute(f.context, request)
  assert.deepEqual(f.feedback.execute(f.context, request).result, result.result)
  assert.throws(
    () =>
      f.feedback.execute(f.context, {
        ...request,
        payload: { ...request.payload, reason: 'Changed' }
      }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT'
  )
  assert.throws(
    () => f.feedback.byApplication({}, f.candidateId),
    (e) => e.code === 'INVALID_ACTOR'
  )
  assert.deepEqual(decisionCounts(f.db), [1, 1, 1, 0])
})

test('DEV-07 Feedback, receipt and event faults roll back Feedback and aggregate version', (t) => {
  const f = decisionFixture(t),
    i = f.interview(f.candidateId),
    candidate = { ...f.db.prepare('SELECT * FROM candidates').get() }
  for (const table of ['feedback', 'command_receipts', 'business_events']) {
    f.db.exec(
      'CREATE TRIGGER fault BEFORE INSERT ON ' +
        table +
        " BEGIN SELECT RAISE(ABORT,'feedback fault'); END"
    )
    assert.throws(() => f.submit(i), /feedback fault/)
    assert.deepEqual(decisionCounts(f.db), [0, 0, 0, 0])
    assert.deepEqual({ ...f.db.prepare('SELECT * FROM candidates').get() }, candidate)
    f.db.exec('DROP TRIGGER fault')
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})
