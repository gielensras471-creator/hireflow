import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as sqlite from 'node:sqlite'
import { createOfferService } from '../server/services/offer-service.js'
import { createInterviewService } from '../server/services/interview-service.js'
import { createRecruitingService } from '../server/services/recruiting-service.js'
import { decisionFixture } from './helpers/decision-db.js'
import { createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'

const code = (expected) => (error) => error.code === expected
const row = (db, table, id) => ({ ...db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id) })
const count = (db, table) => db.prepare('SELECT COUNT(*) n FROM ' + table).get().n
const state = (db) =>
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
const closure = (outcome = 'company_rejected') => ({ outcome, reason: 'Actual closure reason' })
const setup = (t) => {
  const f = decisionFixture(t)
  const service = createOfferService({ db: f.db, resolveActor: f.resolveActor })
  const request = (command, payload = {}, id = f.candidateId, extra = {}) =>
    f.request(command, payload, {
      aggregateId: id,
      expectedVersion: row(f.db, 'candidates', id).version,
      ...extra
    })
  const run = (command, payload, id) => service.execute(f.context, request(command, payload, id))
  return { ...f, service, request, run }
}
const activeStates = [
  { stage: 'screening' },
  { stage: 'first_interview' },
  { stage: 'second_interview' },
  ...['preparing', 'sent', 'accepted'].map((offer_status) => ({ stage: 'offer', offer_status }))
]
const verifyDatabase = (db) => {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
}

test('DEV-09 actual advancement starts preparing; send, acceptance and HR hiring are separate audited decisions', (t) => {
  const f = setup(t),
    id = f.candidateId
  let now = 10000
  t.mock.method(Date, 'now', () => now)
  f.advance({ reason: 'Waive first-round evaluation' })
  f.advance({ reason: 'Waive second-round evaluation' })
  const start = f.service.offerDetail(f.context, id)
  assert.deepEqual(
    [start.stage, start.application_status, start.offer_status, start.outcome],
    ['offer', 'active', 'preparing', null]
  )
  assert.deepEqual(f.service.history(f.context, id), [])
  assert.equal(f.service.offerPreflight(f.context, id).actions['offer.send'].allowed, true)
  const steps = [
    ['offer.send', 'offer_sent', 'sent', 'active', null],
    ['offer.accept', 'offer_accepted', 'accepted', 'active', null],
    ['offer.confirmHire', 'candidate_hired', 'accepted', 'closed', 'hired']
  ]
  for (const [command, eventType, offerStatus, status, outcome] of steps) {
    now += 1000
    const before = row(f.db, 'candidates', id),
      request = f.request(command)
    const result = f.service.execute(f.context, request)
    const after = row(f.db, 'candidates', id),
      event = f.service.history(f.context, id).at(-1)
    assert.deepEqual(
      [after.offer_status, after.application_status, after.outcome],
      [offerStatus, status, outcome]
    )
    assert.deepEqual(event.before, before)
    assert.deepEqual(event.after, after)
    assert.equal(event.event_type, eventType)
    assert.equal(event.actor_user_id, 1)
    assert.equal(event.actor_name_snapshot, 'Test HR')
    assert.equal(event.occurred_at, now)
    assert.equal(event.aggregate_version, before.version + 1)
    assert.equal(event.command_id, result.result.commandId)
    assert.equal(
      f.db
        .prepare('SELECT actor_user_id FROM command_receipts WHERE command_id=?')
        .get(event.command_id).actor_user_id,
      1
    )
    const saved = state(f.db)
    assert.deepEqual(f.service.execute(f.context, request), {
      replayed: true,
      result: result.result
    })
    assert.throws(
      () => f.run(command),
      code(status === 'closed' ? 'APPLICATION_CLOSED' : 'INVALID_OFFER_STATUS')
    )
    assert.deepEqual(state(f.db), saved)
  }
  const events = f.service.history(f.context, id)
  assert.deepEqual(
    events.map((e) => e.event_type),
    steps.map((step) => step[1])
  )
  assert.equal(events[1].after.closed_at, null)
  assert.equal(events[2].after.closed_at, now)
  assert.equal(events[2].reason, 'HR 确认录用')
  assert.equal(events[2].context.reasonSource, 'system_default')
})

test('DEV-09 offer actions enforce the full transition table for active and closed applications', (t) => {
  const f = setup(t)
  const closed = (stage, offer_status, outcome) => ({
    stage,
    offer_status,
    application_status: 'closed',
    outcome,
    closed_reason: 'Prior decision',
    closed_at: 20
  })
  const cases = [
    ...activeStates,
    closed('first_interview', null, 'company_rejected'),
    closed('offer', 'accepted', 'hired'),
    closed('offer', 'declined', 'offer_declined'),
    closed('offer', 'sent', 'candidate_withdrew')
  ]
  const actions = [
    ['offer.send', 'preparing', 'sent', null],
    ['offer.accept', 'sent', 'accepted', null],
    ['offer.decline', 'sent', 'declined', 'offer_declined'],
    ['offer.confirmHire', 'accepted', 'accepted', 'hired']
  ]
  for (const candidate of cases)
    for (const [command, from, to, outcome] of actions) {
      const id = f.candidate(candidate),
        before = row(f.db, 'candidates', id),
        saved = state(f.db)
      const eligible =
        candidate.application_status !== 'closed' &&
        candidate.stage === 'offer' &&
        candidate.offer_status === from
      const pre = f.service.offerPreflight(f.context, id).actions[command]
      assert.equal(pre.allowed, eligible)
      const input = outcome ? { reason: 'HR supplied reason' } : {}
      if (!eligible) {
        const expected =
          candidate.application_status === 'closed'
            ? 'APPLICATION_CLOSED'
            : candidate.stage === 'offer'
              ? 'INVALID_OFFER_STATUS'
              : 'INVALID_OFFER_STAGE'
        assert.equal(pre.blockedReason, expected)
        assert.throws(() => f.run(command, input, id), code(expected))
        assert.deepEqual(state(f.db), saved)
        continue
      }
      f.run(command, input, id)
      const after = row(f.db, 'candidates', id)
      assert.deepEqual(
        [after.stage, after.offer_status, after.outcome, after.application_status],
        ['offer', to, outcome, outcome ? 'closed' : 'active']
      )
      assert.equal(after.version, before.version + 1)
      if (outcome) {
        assert.equal(after.closed_reason, input.reason)
        assert(after.closed_at >= before.created_at)
      }
    }
  verifyDatabase(f.db)
})

test('DEV-09 offer decline atomically closes with one truthful event and rejects retry mutation', (t) => {
  const f = setup(t),
    id = f.candidate({ stage: 'offer', offer_status: 'sent' })
  t.mock.method(Date, 'now', () => 12345)
  for (const reason of [undefined, '', ' ', 12]) {
    assert.throws(
      () => f.run('offer.decline', reason === undefined ? {} : { reason }, id),
      code('CLOSURE_REASON_REQUIRED')
    )
  }
  const before = row(f.db, 'candidates', id),
    request = f.request('offer.decline', { reason: 'Candidate declined' }, id)
  const result = f.service.execute(f.context, request)
  const after = row(f.db, 'candidates', id)
  assert.deepEqual(after, {
    ...before,
    offer_status: 'declined',
    application_status: 'closed',
    outcome: 'offer_declined',
    closed_reason: 'Candidate declined',
    closed_at: 12345,
    version: before.version + 1
  })
  const [event] = f.service.history(f.context, id)
  assert.equal(event.event_type, 'offer_declined')
  assert.equal(event.reason, after.closed_reason)
  assert.deepEqual(event.before, before)
  assert.deepEqual(event.after, after)
  assert.deepEqual(event.context, {
    stage: 'offer',
    previousOfferStatus: 'sent',
    offerStatus: 'declined',
    outcome: 'offer_declined',
    reasonSource: 'hr_input'
  })
  const saved = state(f.db)
  assert.deepEqual(f.service.execute(f.context, request), { replayed: true, result: result.result })
  assert.throws(
    () => f.service.execute(f.context, { ...request, payload: { reason: 'Changed' } }),
    code('IDEMPOTENCY_CONFLICT')
  )
  for (const command of [
    'offer.send',
    'offer.accept',
    'offer.decline',
    'offer.confirmHire',
    'application.close'
  ])
    assert.throws(() => f.run(command, closure(), id), code('APPLICATION_CLOSED'))
  assert.deepEqual(state(f.db), saved)
  assert.equal(count(f.db, 'business_events'), 1)
  assert.equal(count(f.db, 'command_receipts'), 1)
})

test('DEV-09 company termination and withdrawal preserve stage and offer status in every active combination', (t) => {
  const f = setup(t)
  t.mock.method(Date, 'now', () => 54321)
  for (const candidate of activeStates)
    for (const outcome of ['company_rejected', 'candidate_withdrew']) {
      const id = f.candidate(candidate),
        before = row(f.db, 'candidates', id)
      const pre = f.service.closurePreflight(f.context, id)
      assert.equal(pre.allowed, true)
      assert.deepEqual(pre.allowedOutcomes, ['company_rejected', 'candidate_withdrew'])
      const request = f.request('application.close', closure(outcome), id)
      const result = f.service.execute(f.context, request)
      const after = row(f.db, 'candidates', id)
      assert.deepEqual(after, {
        ...before,
        application_status: 'closed',
        outcome,
        closed_reason: 'Actual closure reason',
        closed_at: 54321,
        version: before.version + 1
      })
      const events = f.service.history(f.context, id)
      assert.equal(events.length, 1)
      assert.equal(events[0].event_type, 'application_closed')
      assert.equal(events[0].reason, after.closed_reason)
      assert.equal(events[0].occurred_at, after.closed_at)
      assert.deepEqual(events[0].context, {
        stage: before.stage,
        previousOfferStatus: before.offer_status,
        offerStatus: before.offer_status,
        outcome,
        reasonSource: 'hr_input'
      })
      assert.deepEqual(events[0].before, before)
      assert.deepEqual(events[0].after, after)
      assert.deepEqual(f.service.execute(f.context, request), {
        replayed: true,
        result: result.result
      })
      assert.equal(f.service.closurePreflight(f.context, id).blockedReason, 'APPLICATION_CLOSED')
    }
  assert.equal(count(f.db, 'business_events'), 12)
  assert.equal(count(f.db, 'command_receipts'), 12)
})

test('DEV-09 every closure checks any scheduled interview again inside the command, including old rounds', (t) => {
  const f = setup(t),
    interviews = createInterviewService({ db: f.db, resolveActor: f.resolveActor })
  const cases = [
    ...activeStates.map((candidate) => [candidate, 'application.close', closure()]),
    [{ stage: 'offer', offer_status: 'sent' }, 'offer.decline', { reason: 'Declined' }],
    [{ stage: 'offer', offer_status: 'accepted' }, 'offer.confirmHire', {}]
  ]
  for (const [index, [candidate, command, payload]] of cases.entries()) {
    const id = f.candidate(candidate)
    assert(f.service.closurePreflight(f.context, id).allowed)
    const meeting = f.interview(id, {
      stage_scope: 'first_interview',
      status: 'scheduled',
      completed_at: null
    })
    const before = state(f.db),
      pre = f.service.closurePreflight(f.context, id)
    assert.equal(pre.blockedReason, 'SCHEDULED_INTERVIEW_PENDING')
    assert.equal(pre.pendingInterviews[0].id, meeting)
    if (command !== 'application.close')
      assert.equal(
        f.service.offerPreflight(f.context, id).actions[command].blockedReason,
        'SCHEDULED_INTERVIEW_PENDING'
      )
    assert.throws(() => f.run(command, payload, id), code('SCHEDULED_INTERVIEW_PENDING'))
    assert.deepEqual(state(f.db), before)
    const cancelled = index % 2 === 0
    interviews.execute(
      f.context,
      f.request(
        cancelled ? 'interview.cancel' : 'interview.complete',
        {
          interview_id: meeting,
          interview_version: 1,
          ...(cancelled ? { reason: 'HR cancelled appointment' } : {})
        },
        id
      )
    )
    const settled = row(f.db, 'interviews', meeting)
    assert.equal(settled.status, cancelled ? 'cancelled' : 'completed')
    f.run(command, payload, id)
    assert.deepEqual(row(f.db, 'interviews', meeting), settled)
  }
  assert.equal(count(f.db, 'feedback'), 0)
  verifyDatabase(f.db)
})

test('DEV-09 closed applications keep DEV-08 correction and reject ordinary writes and new feedback', (t) => {
  const f = setup(t),
    id = f.candidateId
  const rated = f.interview(id),
    waived = f.interview(id)
  const submitted = f.submit(rated).result
  f.advance({ reason: 'Prior waiver' })
  const current = f.interview(id, { stage_scope: 'second_interview' })
  const originalHistory = f.advancement.history(f.context, id)
  f.run('application.close', closure('candidate_withdrew'))
  const before = state(f.db),
    interviews = createInterviewService({ db: f.db, resolveActor: f.resolveActor }),
    recruiting = createRecruitingService({ db: f.db, resolveActor: f.resolveActor })
  const payload = {
    interview_id: waived,
    reviewer_name: 'Reviewer',
    recommendation: 'recommend',
    reason: 'Assessment'
  }
  assert.throws(
    () => f.feedback.execute(f.context, f.request('feedback.supplement', payload)),
    code('APPLICATION_CLOSED')
  )
  assert.throws(() => f.submit(current), code('APPLICATION_CLOSED'))
  assert.throws(() => f.advance({ reason: 'Try moving' }), code('APPLICATION_CLOSED'))
  assert.throws(
    () =>
      interviews.execute(
        f.context,
        f.request('interview.schedule', { scheduled_at: 1000, interviewer_name: 'Reviewer' })
      ),
    code('APPLICATION_CLOSED')
  )
  assert.throws(
    () =>
      interviews.execute(
        f.context,
        f.request('interview.complete', { interview_id: current, interview_version: 1 })
      ),
    code('APPLICATION_CLOSED')
  )
  assert.throws(
    () => recruiting.execute(f.context, f.request('application.update', { note: 'Ordinary edit' })),
    code('APPLICATION_CLOSED')
  )
  assert.deepEqual(state(f.db), before)
  const corrected = f.feedback.execute(
    f.context,
    f.request('feedback.correct', {
      interview_id: rated,
      feedback_revision: 1,
      correction_reason: 'Correct typo',
      reason: 'Corrected assessment'
    })
  ).result
  assert.equal(corrected.feedbackId, submitted.feedbackId)
  assert.equal(corrected.feedbackRevision, 2)
  assert.deepEqual(row(f.db, 'candidates', id), {
    ...before.candidates[0],
    version: before.candidates[0].version + 1
  })
  assert.deepEqual(f.advancement.history(f.context, id), originalHistory)
})

test('DEV-09 rejects forged lifecycle, outcome and audit inputs at service and ordinary edit entry points', (t) => {
  const f = setup(t),
    recruiting = createRecruitingService({ db: f.db, resolveActor: f.resolveActor })
  const before = state(f.db)
  for (const stage of activeStates) {
    const id = f.candidate(stage)
    for (const outcome of ['hired', 'offer_declined', null, 'invalid'])
      assert.throws(
        () => f.run('application.close', closure(outcome), id),
        code('INVALID_CLOSURE_OUTCOME')
      )
  }
  for (const reason of [null, '', ' ', 42])
    assert.throws(
      () => f.run('application.close', { ...closure(), reason }),
      code('CLOSURE_REASON_REQUIRED')
    )
  for (const field of [
    'actor_user_id',
    'actor_name_snapshot',
    'closed_at',
    'stage',
    'offer_status',
    'application_status',
    'closed_reason'
  ]) {
    assert.throws(
      () => f.run('application.close', { ...closure(), [field]: 1 }),
      code('INVALID_FIELDS')
    )
    assert.throws(
      () => recruiting.execute(f.context, f.request('application.update', { [field]: 1 })),
      code('INVALID_FIELDS')
    )
  }
  assert.throws(
    () => recruiting.execute(f.context, f.request('application.update', { outcome: 'hired' })),
    code('INVALID_FIELDS')
  )
  const offer = f.candidate({ stage: 'offer', offer_status: 'accepted' })
  assert.throws(
    () => f.run('offer.confirmHire', { reason: ' ' }, offer),
    code('CLOSURE_REASON_REQUIRED')
  )
  assert.throws(
    () => f.run('offer.confirmHire', { outcome: 'hired' }, offer),
    code('INVALID_FIELDS')
  )
  assert.throws(
    () =>
      f.service.execute(
        f.context,
        f.request('application.close', closure(), f.candidateId, { actor_user_id: 1 })
      ),
    code('INVALID_REQUEST')
  )
  assert.deepEqual(row(f.db, 'candidates', f.candidateId), { ...before.candidates[0] })
  assert.equal(count(f.db, 'business_events'), 0)
  assert.equal(count(f.db, 'command_receipts'), 0)
})

test('DEV-09 queries and commands revalidate authorization; state alone never fabricates history', (t) => {
  const f = setup(t),
    id = f.candidate({ stage: 'offer', offer_status: 'accepted' })
  const request = f.request('offer.confirmHire', {}, id),
    before = state(f.db)
  const queries = ['offerDetail', 'offerPreflight', 'closurePreflight', 'history']
  assert.deepEqual(f.service.history(f.context, id), [])
  for (const query of queries) assert.throws(() => f.service[query]({}, id), code('INVALID_ACTOR'))
  assert.throws(() => f.service.execute({}, request), code('INVALID_ACTOR'))
  f.sessions.set(f.context, 999)
  for (const query of queries)
    assert.throws(() => f.service[query](f.context, id), code('INVALID_ACTOR'))
  assert.throws(() => f.service.execute(f.context, request), code('INVALID_ACTOR'))
  f.sessions.set(f.context, 1)
  f.db.exec("UPDATE users SET role='interviewer' WHERE id=1")
  for (const query of queries)
    assert.throws(() => f.service[query](f.context, id), code('FORBIDDEN'))
  assert.throws(() => f.service.execute(f.context, request), code('FORBIDDEN'))
  assert.deepEqual(state(f.db), before)
})

test('DEV-09 stale versions and injected receipt/event failures leave candidate and audit rows intact', (t) => {
  const f = setup(t)
  const cases = [
    ['offer.send', 'preparing', {}],
    ['offer.accept', 'sent', {}],
    ['offer.decline', 'sent', { reason: 'Declined' }],
    ['offer.confirmHire', 'accepted', {}],
    ['application.close', 'accepted', closure()]
  ]
  for (const [command, offer_status, payload] of cases) {
    const id = f.candidate({ stage: 'offer', offer_status }),
      before = state(f.db)
    assert.throws(
      () => f.service.execute(f.context, f.request(command, payload, id, { expectedVersion: 2 })),
      code('VERSION_CONFLICT')
    )
    for (const table of ['command_receipts', 'business_events']) {
      f.db.exec(
        'CREATE TRIGGER fault BEFORE INSERT ON ' +
          table +
          " BEGIN SELECT RAISE(ABORT,'DEV-09 audit fault'); END"
      )
      assert.throws(() => f.run(command, payload, id), /DEV-09 audit fault/)
      assert.deepEqual(state(f.db), before)
      assert.equal(f.db.isTransaction, false)
      f.db.exec('DROP TRIGGER fault')
    }
  }
  verifyDatabase(f.db)
})

test('DEV-09 two SQLite connections serialize competing terminal decisions and keep a single outcome', async (t) => {
  const f = setup(t),
    id = f.candidate({ stage: 'offer', offer_status: 'sent' }),
    root = createTestWorkspace(),
    file = path.join(root, 'offer-decisions.db')
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
  const sa = createOfferService({ db: a, resolveActor: f.resolveActor }),
    sb = createOfferService({ db: b, resolveActor: f.resolveActor })
  const decline = f.request('offer.decline', { reason: 'Candidate refused' }, id),
    withdraw = f.request('application.close', closure('candidate_withdrew'), id)
  a.exec('BEGIN IMMEDIATE')
  assert.throws(() => sb.execute(f.context, withdraw), code('COMMAND_BUSY'))
  a.exec('ROLLBACK')
  const result = sa.execute(f.context, decline)
  assert.deepEqual(sb.execute(f.context, decline), { replayed: true, result: result.result })
  assert.throws(() => sb.execute(f.context, withdraw), code('VERSION_CONFLICT'))
  assert.throws(
    () => sb.execute(f.context, { ...withdraw, expectedVersion: result.result.version }),
    code('APPLICATION_CLOSED')
  )
  assert.equal(row(b, 'candidates', id).outcome, 'offer_declined')
  assert.deepEqual(
    sb.history(f.context, id).map((e) => e.event_type),
    ['offer_declined']
  )
  assert.equal(count(b, 'command_receipts'), 1)
  verifyDatabase(b)
})
