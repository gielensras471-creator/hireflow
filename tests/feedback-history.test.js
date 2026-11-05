import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { createFeedbackService } from '../server/services/feedback-service.js'
import { decisionFixture } from './helpers/decision-db.js'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import { insert } from './helpers/v3-db.js'

const code = (expected) => (error) => error.code === expected
const evaluate = (id, extra = {}) => ({
  interview_id: id,
  reviewer_name: 'Independent reviewer',
  recommendation: 'not_recommend',
  reason: 'Professional assessment',
  ...extra
})
const correction = (id, revision, extra = {}) => ({
  interview_id: id,
  feedback_revision: revision,
  correction_reason: 'Correct transcription',
  recommendation: 'recommend',
  ...extra
})
const execute = (f, action, payload, options) =>
  f.feedback.execute(f.context, f.request('feedback.' + action, payload, options))
const row = (db, table, id) => ({ ...db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id) })
const snapshot = (db) =>
  Object.fromEntries(
    [
      'candidates',
      'interviews',
      'feedback',
      'business_events',
      'command_receipts',
      'advancement_missing_feedback'
    ].map((table) => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()])
  )
const waived = (f) => {
  const id = f.interview(f.candidateId)
  f.advance({ reason: 'Advance with the assessment pending' })
  return id
}
const close = (f) =>
  f.db
    .prepare(
      `
  UPDATE candidates SET application_status='closed',outcome='company_rejected',
    closed_reason='Fixture closure',closed_at=20 WHERE id=?
`
    )
    .run(f.candidateId)
const validDatabase = (db) => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
}

test('DEV-08 supplement uses a real waiver and actual submission facts while preserving the original decision', (t) => {
  const f = decisionFixture(t)
  let clock = 10000
  t.mock.method(Date, 'now', () => clock)
  const id = waived(f)
  const history = f.advancement.history(f.context, f.candidateId)
  const links = snapshot(f.db).advancement_missing_feedback
  const candidate = row(f.db, 'candidates', f.candidateId)
  const current = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  const preflight = f.advancement.preflight(f.context, f.candidateId)
  const eligibility = f.feedback.supplementEligibility(f.context, f.candidateId, id)
  assert.equal(eligibility.canSupplement, true)
  assert.equal(eligibility.historicalMissing, true)
  assert.equal(eligibility.supplementedAt, null)
  assert.equal(eligibility.waivers[0].eventId, history[0].id)
  assert.deepEqual(preflight.missingInterviewIds, [current])
  clock = 20000
  const request = f.request('feedback.supplement', evaluate(id))
  const result = f.feedback.execute(f.context, request)
  const actual = row(f.db, 'feedback', result.result.feedbackId)
  assert.equal(actual.recorded_by_user_id, 1)
  assert.equal(actual.reviewer_name, 'Independent reviewer')
  assert.equal(actual.revision, 1)
  assert.equal(actual.submitted_at, clock)
  const [event] = f.feedback.feedbackHistory(f.context, f.candidateId, actual.id)
  assert.equal(event.event_type, 'feedback_supplemented')
  assert.equal(event.before, null)
  assert.deepEqual(event.after, actual)
  assert.equal(event.actor_user_id, 1)
  assert.equal(event.interview_id, id)
  assert.equal(event.occurred_at, clock)
  assert.deepEqual(event.context, {
    kind: 'post_advancement_supplement',
    stageScope: 'first_interview',
    waiverEventId: history[0].id
  })
  assert.equal(event.priorAdvancementEventId, history[0].id)
  assert.deepEqual(f.advancement.history(f.context, f.candidateId), history)
  assert.deepEqual(snapshot(f.db).advancement_missing_feedback, links)
  assert.deepEqual(row(f.db, 'candidates', f.candidateId), {
    ...candidate,
    version: candidate.version + 1
  })
  assert.deepEqual(f.advancement.preflight(f.context, f.candidateId).missingInterviewIds, [current])
  f.submit(current)
  const ratings = f.feedback.byApplication(f.context, f.candidateId)
  assert.deepEqual(
    ratings.map((rating) => rating.currentRound),
    [false, true]
  )
  const [historical] = f.feedback.historicalMissing(f.context, f.candidateId)
  assert.equal(historical.historicalMissing, false)
  assert.equal(historical.supplementEventId, event.id)
  assert.equal(historical.supplementedAt, clock)
  assert.deepEqual(historical.waivers, eligibility.waivers)
  assert.throws(() => execute(f, 'supplement', evaluate(id)), code('FEEDBACK_ALREADY_EXISTS'))
  assert.throws(
    () =>
      f.feedback.execute(f.context, { ...request, payload: evaluate(id, { reason: 'Different' }) }),
    code('IDEMPOTENCY_CONFLICT')
  )
  close(f)
  const beforeReplay = snapshot(f.db)
  assert.deepEqual(f.feedback.execute(f.context, request), {
    replayed: true,
    result: result.result
  })
  assert.deepEqual(snapshot(f.db), beforeReplay)
  validDatabase(f.db)
})

test('DEV-08 denies supplement without matching database evidence and guards status, scope and closure', (t) => {
  const f = decisionFixture(t)
  const eligible = waived(f)
  const withoutWaiver = f.interview(f.candidateId)
  const current = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  const scheduled = f.interview(f.candidateId, { status: 'scheduled', completed_at: null })
  const cancelled = f.interview(f.candidateId, {
    status: 'cancelled',
    completed_at: null,
    cancelled_at: 2,
    cancel_reason: 'Fixture'
  })
  const foreign = f.interview(f.candidate())
  assert.throws(
    () => execute(f, 'supplement', evaluate(withoutWaiver)),
    code('HISTORICAL_WAIVER_REQUIRED')
  )
  // The FK permits linking another completed interview to a reasoned advancement event.
  // Its immutable event context still proves that this interview was not waived.
  const [advance] = f.advancement.history(f.context, f.candidateId)
  f.db
    .prepare('INSERT INTO advancement_missing_feedback VALUES (?,?,?,?)')
    .run(advance.id, withoutWaiver, f.candidateId, 'first_interview')
  const before = snapshot(f.db)
  for (const [id, expected] of [
    [withoutWaiver, 'HISTORICAL_WAIVER_REQUIRED'],
    [current, 'NOT_PAST_INTERVIEW_ROUND'],
    [scheduled, 'INTERVIEW_NOT_COMPLETED'],
    [cancelled, 'INTERVIEW_NOT_COMPLETED'],
    [foreign, 'INTERVIEW_ASSOCIATION_CONFLICT']
  ])
    assert.throws(() => execute(f, 'supplement', evaluate(id)), code(expected))
  assert.deepEqual(
    f.feedback.historicalMissing(f.context, f.candidateId).map((item) => item.interviewId),
    [eligible]
  )
  assert.deepEqual(snapshot(f.db), before)
  close(f)
  assert.throws(() => execute(f, 'supplement', evaluate(eligible)), code('APPLICATION_CLOSED'))
  const missing = f.feedback.supplementEligibility(f.context, f.candidateId, eligible)
  assert.equal(missing.canSupplement, false)
  assert.equal(missing.historicalMissing, true)
  assert.equal(missing.blockedReason, 'APPLICATION_CLOSED')
})

test('DEV-08 corrections preserve provenance and expose ordered snapshots across advancement and closure', (t) => {
  const f = decisionFixture(t)
  let clock = 10000
  t.mock.method(Date, 'now', () => clock)
  const id = f.interview(f.candidateId)
  const initial = f.submit(id, { recommendation: 'not_recommend' })
  const feedbackId = initial.result.feedbackId
  const original = row(f.db, 'feedback', feedbackId)
  clock = 20000
  f.advance()
  const decisions = f.advancement.history(f.context, f.candidateId)
  const otherUser = insert(f.db, 'users', {
    ...row(f.db, 'users', 1),
    id: 2,
    username: 'correction-hr',
    name: 'Correction HR'
  })
  f.sessions.set(f.context, otherUser)
  clock = 30000
  execute(
    f,
    'correct',
    correction(id, 1, { reviewer_name: 'Correct reviewer', reason: 'Correct evidence' })
  )
  const revised = row(f.db, 'feedback', feedbackId)
  assert.equal(revised.revision, 2)
  assert.equal(revised.reviewer_name, 'Correct reviewer')
  assert.equal(revised.reason, 'Correct evidence')
  assert.equal(revised.recommendation, 'recommend')
  close(f)
  const before = row(f.db, 'candidates', f.candidateId)
  const request = f.request('feedback.correct', correction(id, 2, { reason: 'Clarified evidence' }))
  const result = f.feedback.execute(f.context, request)
  assert.deepEqual(f.feedback.execute(f.context, request), {
    replayed: true,
    result: result.result
  })
  assert.throws(
    () =>
      f.feedback.execute(f.context, {
        ...request,
        payload: { ...request.payload, reason: 'Other' }
      }),
    code('IDEMPOTENCY_CONFLICT')
  )
  const final = row(f.db, 'feedback', feedbackId)
  assert.deepEqual(final, { ...revised, reason: 'Clarified evidence', revision: 3 })
  for (const key of ['id', 'interview_id', 'recorded_by_user_id', 'submitted_at'])
    assert.equal(final[key], original[key])
  assert.deepEqual(row(f.db, 'candidates', f.candidateId), {
    ...before,
    version: before.version + 1
  })
  assert.deepEqual(f.advancement.history(f.context, f.candidateId), decisions)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM feedback').get().n, 1)
  const [submitted, first, second] = f.feedback.feedbackHistory(
    f.context,
    f.candidateId,
    feedbackId
  )
  assert.equal(submitted.priorAdvancementEventId, null)
  assert.deepEqual(submitted.after, original)
  for (const [event, old, next] of [
    [first, original, revised],
    [second, revised, final]
  ]) {
    assert.equal(event.event_type, 'feedback_corrected')
    assert.equal(event.actor_user_id, otherUser)
    assert.equal(event.actor_name_snapshot, 'Correction HR')
    assert.equal(event.occurred_at, clock)
    assert.equal(event.reason, 'Correct transcription')
    assert.deepEqual(event.before, old)
    assert.deepEqual(event.after, next)
    assert.deepEqual(event.context, { fromRevision: old.revision, toRevision: next.revision })
    assert.equal(event.priorAdvancementEventId, decisions[0].id)
  }
  assert(first.aggregate_version < second.aggregate_version)
  assert.throws(
    () => f.db.prepare('UPDATE business_events SET reason=? WHERE id=?').run('Changed', first.id),
    /immutable/
  )
  assert.equal(f.feedback.byApplication(f.context, f.candidateId)[0].corrected, true)
  const unrated = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  assert.throws(() => f.submit(unrated), code('APPLICATION_CLOSED'))
  assert.throws(() => execute(f, 'correct', correction(unrated, 1)), code('FEEDBACK_NOT_FOUND'))
  validDatabase(f.db)
})

test('DEV-08 corrects current-round feedback with dual versions and rejects ordinary overwrite, stale or unchanged input', (t) => {
  const f = decisionFixture(t)
  const id = f.interview(f.candidateId)
  f.submit(id)
  const before = snapshot(f.db)
  assert.throws(() => f.submit(id, { reason: 'Overwrite' }), code('FEEDBACK_ALREADY_EXISTS'))
  assert.throws(
    () => execute(f, 'correct', correction(id, 1, { correction_reason: ' ' })),
    code('CORRECTION_REASON_REQUIRED')
  )
  assert.throws(() => execute(f, 'correct', correction(id, 1)), code('NO_CHANGE'))
  assert.throws(
    () => execute(f, 'correct', correction(id, 1, { reason: 'Updated' }), { expectedVersion: 1 }),
    code('VERSION_CONFLICT')
  )
  assert.throws(
    () => execute(f, 'correct', correction(id, 2, { reason: 'Updated' })),
    code('FEEDBACK_REVISION_CONFLICT')
  )
  assert.deepEqual(snapshot(f.db), before)
  const result = execute(f, 'correct', correction(id, 1, { reason: 'Updated' }))
  assert.equal(result.result.feedbackRevision, 2)
  assert.equal(f.feedback.byApplication(f.context, f.candidateId)[0].currentRound, true)
})

test('DEV-08 all feedback reads/writes enforce trusted authorization and reject forged audit or association fields', (t) => {
  const f = decisionFixture(t)
  const id = waived(f),
    current = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  const initial = f.submit(current)
  const other = f.candidate(),
    foreign = f.interview(other),
    foreignFeedback = f.db
      .prepare(
        `
    INSERT INTO feedback(interview_id,reviewer_name,recorded_by_user_id,recommendation,reason,submitted_at)
    VALUES (?,'Other reviewer',1,'recommend','Test',1)
  `
      )
      .run(foreign)
  const before = snapshot(f.db)
  const queries = [
    (context) => f.feedback.byApplication(context, f.candidateId),
    (context) => f.feedback.supplementEligibility(context, f.candidateId, id),
    (context) => f.feedback.historicalMissing(context, f.candidateId),
    (context) => f.feedback.feedbackHistory(context, f.candidateId, initial.result.feedbackId)
  ]
  const requests = [
    f.request('feedback.supplement', evaluate(id)),
    f.request('feedback.correct', correction(current, 1, { reason: 'Updated' }))
  ]
  for (const query of queries)
    assert.throws(() => query({ userId: 1, role: 'hr' }), code('INVALID_ACTOR'))
  for (const request of requests)
    assert.throws(() => f.feedback.execute({}, request), code('INVALID_ACTOR'))
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  for (const query of queries) assert.throws(() => query(f.context), code('FORBIDDEN'))
  for (const request of requests)
    assert.throws(() => f.feedback.execute(f.context, request), code('FORBIDDEN'))
  f.db.exec("UPDATE users SET role='招聘管理员' WHERE id=1")
  f.sessions.set(f.context, 999)
  for (const request of requests)
    assert.throws(() => f.feedback.execute(f.context, request), code('INVALID_ACTOR'))
  f.sessions.set(f.context, 1)
  for (const request of requests) {
    for (const key of [
      'recorded_by_user_id',
      'submitted_at',
      'revision',
      'id',
      'actor_user_id',
      'stage',
      'historical',
      'canSupplement',
      'waiverEventId',
      'occurred_at'
    ])
      assert.throws(
        () =>
          f.feedback.execute(f.context, { ...request, payload: { ...request.payload, [key]: 1 } }),
        code('INVALID_FIELDS')
      )
    assert.throws(
      () => f.feedback.execute(f.context, { ...request, actor_user_id: 1 }),
      code('INVALID_REQUEST')
    )
  }
  assert.throws(
    () => execute(f, 'correct', correction(foreign, 1)),
    code('INTERVIEW_ASSOCIATION_CONFLICT')
  )
  assert.throws(
    () =>
      f.feedback.feedbackHistory(f.context, f.candidateId, Number(foreignFeedback.lastInsertRowid)),
    code('FEEDBACK_NOT_FOUND')
  )
  assert.deepEqual(snapshot(f.db), before)
})

test('DEV-08 injected Feedback/receipt/event failures roll back both new rows and in-place corrections', (t) => {
  const f = decisionFixture(t)
  const missing = waived(f),
    current = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  f.submit(current)
  const before = snapshot(f.db)
  for (const [action, payload, operation] of [
    ['supplement', evaluate(missing), 'INSERT'],
    ['correct', correction(current, 1, { reason: 'Updated' }), 'UPDATE']
  ]) {
    for (const table of ['feedback', 'command_receipts', 'business_events']) {
      f.db.exec(
        'CREATE TRIGGER fault BEFORE ' +
          (table === 'feedback' ? operation : 'INSERT') +
          ' ON ' +
          table +
          " BEGIN SELECT RAISE(ABORT,'DEV-08 fault'); END"
      )
      assert.throws(() => execute(f, action, payload), /DEV-08 fault/)
      assert.deepEqual(snapshot(f.db), before)
      assert.equal(f.db.isTransaction, false)
      f.db.exec('DROP TRIGGER fault')
    }
  }
  validDatabase(f.db)
})

test('DEV-08 two real SQLite connections serialize supplement and correct without duplicate rows or lost updates', async (t) => {
  const f = decisionFixture(t),
    id = waived(f),
    root = createTestWorkspace(),
    file = path.join(root, 'feedback-history.db')
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
  const sa = createFeedbackService({ db: a, resolveActor: f.resolveActor }),
    sb = createFeedbackService({ db: b, resolveActor: f.resolveActor })
  const supplement = f.request('feedback.supplement', evaluate(id))
  a.exec('BEGIN IMMEDIATE')
  assert.throws(() => sb.execute(f.context, supplement), code('COMMAND_BUSY'))
  a.exec('ROLLBACK')
  const added = sa.execute(f.context, supplement)
  assert.equal(sb.execute(f.context, supplement).replayed, true)
  assert.throws(
    () =>
      sb.execute(f.context, {
        ...supplement,
        expectedVersion: added.result.version,
        idempotencyKey: 'other-supplement'
      }),
    code('FEEDBACK_ALREADY_EXISTS')
  )
  const correct = f.request('feedback.correct', correction(id, 1), {
    expectedVersion: added.result.version
  })
  a.exec('BEGIN IMMEDIATE')
  assert.throws(() => sb.execute(f.context, correct), code('COMMAND_BUSY'))
  a.exec('ROLLBACK')
  const result = sa.execute(f.context, correct)
  assert.equal(sb.execute(f.context, correct).replayed, true)
  assert.throws(
    () => sb.execute(f.context, { ...correct, idempotencyKey: 'other-correction' }),
    code('VERSION_CONFLICT')
  )
  assert.throws(
    () =>
      sb.execute(f.context, {
        ...correct,
        idempotencyKey: 'fresh-aggregate',
        expectedVersion: result.result.version
      }),
    code('FEEDBACK_REVISION_CONFLICT')
  )
  assert.equal(b.prepare('SELECT COUNT(*) n FROM feedback').get().n, 1)
  assert.equal(row(b, 'feedback', added.result.feedbackId).revision, 2)
  assert.equal(
    b.prepare("SELECT COUNT(*) n FROM business_events WHERE event_type='feedback_corrected'").get()
      .n,
    1
  )
  assert.equal(b.prepare('SELECT COUNT(*) n FROM command_receipts').get().n, 3)
  validDatabase(b)
})

test('DEV-08 supplements either waived round in Offer and retains the correct original decision', (t) => {
  const f = decisionFixture(t)
  const first = waived(f)
  const second = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  f.advance({ reason: 'Advance with the second assessment pending' })
  const before = row(f.db, 'candidates', f.candidateId)
  const decisions = f.advancement.history(f.context, f.candidateId)
  const links = snapshot(f.db).advancement_missing_feedback
  assert.equal(before.offer_status, 'preparing')
  for (const [index, id] of [first, second].entries()) {
    const result = execute(f, 'supplement', evaluate(id))
    const [event] = f.feedback.feedbackHistory(f.context, f.candidateId, result.result.feedbackId)
    assert.equal(event.context.waiverEventId, decisions[index].id)
    assert.equal(event.priorAdvancementEventId, decisions[index].id)
  }
  assert.deepEqual(row(f.db, 'candidates', f.candidateId), {
    ...before,
    version: before.version + 2
  })
  assert.deepEqual(f.advancement.history(f.context, f.candidateId), decisions)
  assert.deepEqual(snapshot(f.db).advancement_missing_feedback, links)
})
