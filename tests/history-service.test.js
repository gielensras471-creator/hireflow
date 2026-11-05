import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboardService } from '../server/services/dashboard-service.js'
import { createHistoryService } from '../server/services/history-service.js'
import { assertReadOnly, evaluation, readFixture } from './helpers/read-db.js'
import { insert } from './helpers/v3-db.js'

const types = ({ items }) => items.map((item) => item.eventType)
const terminal = { outcome: 'company_rejected', reason: 'Role requirements changed' }
const rename = 'Current position name'
const createPosition = {
  title: 'Same role',
  department: 'Test',
  location: 'Test',
  publish_date: '2026-11-03',
  description: 'Fictional position'
}

test('DEV-10 history returns real application, interview and position events with original snapshots', (t) => {
  const f = readFixture(t)
  t.mock.method(Date, 'now', () => 25000)
  const { aggregateId: positionId } = f.recruit('position.create', createPosition)
  const { aggregateId: otherPosition } = f.recruit('position.create', createPosition)
  const create = (position_id) =>
    f.recruit('application.create', {
      position_id,
      name: 'Same applicant',
      owner: 'Business owner',
      applied_date: '2026-11-03'
    }).aggregateId
  const candidateId = create(positionId)
  const otherCandidate = create(otherPosition)
  f.recruit('application.update', { note: 'Initial screening notes' }, candidateId, 1)
  f.run(f.advancement, 'application.advance', {}, candidateId)
  const runInterview = (command, payload) =>
    f.run(f.interviews, 'interview.' + command, payload, candidateId)
  const schedule = (scheduled_at) =>
    runInterview('schedule', { scheduled_at, interviewer_name: 'Reviewer' })
  const completed = schedule(20000)
  const revision = runInterview('reschedule', {
    interview_id: completed.interviewId,
    interview_version: completed.interviewVersion,
    scheduled_at: 24000
  })
  runInterview('complete', {
    interview_id: revision.interviewId,
    interview_version: revision.interviewVersion
  })
  const cancelled = schedule(26000)
  runInterview('cancel', {
    interview_id: cancelled.interviewId,
    interview_version: cancelled.interviewVersion,
    reason: 'Availability changed'
  })
  f.run(f.feedback, 'feedback.submit', evaluation(completed.interviewId), candidateId)
  f.recruit('position.update', { title: rename }, positionId, 1)
  f.recruit('position.status', { status: 'closed' }, positionId, 2)
  f.recruit('position.delete', {}, positionId, 3)
  f.db.exec("UPDATE users SET name='New account name' WHERE id=1")
  const history = createHistoryService(f.dependencies)

  assertReadOnly(f.db, () => {
    const data = history.byApplication(f.context, candidateId)
    assert.deepEqual(types(data), [
      'candidate_created',
      'candidate_updated',
      'stage_advanced',
      'interview_scheduled',
      'interview_rescheduled',
      'interview_completed',
      'interview_scheduled',
      'interview_cancelled',
      'feedback_submitted'
    ])
    assert.deepEqual(data.currentPosition, { positionId, title: rename })
    const persisted = f.db
      .prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id')
      .all(candidateId)
    for (const [i, event] of data.items.entries()) {
      const row = persisted[i]
      assert.deepEqual(
        [
          event.eventId,
          event.aggregateType,
          event.aggregateId,
          event.candidateId,
          event.positionId,
          event.commandId,
          event.aggregateVersion,
          event.actorUserId,
          event.actorNameSnapshot,
          event.occurredAt
        ],
        [
          row.id,
          'candidate',
          candidateId,
          candidateId,
          positionId,
          row.command_id,
          i + 1,
          1,
          'Test HR',
          25000
        ]
      )
      assert.equal(event.interviewId, row.interview_id)
      assert.equal(event.feedbackId, row.feedback_id)
      assert.equal(event.reason, row.reason)
      assert.deepEqual(event.before, JSON.parse(row.old_values_json))
      assert.deepEqual(event.after, JSON.parse(row.new_values_json))
      assert.deepEqual(event.context, JSON.parse(row.context_json))
    }
    assert.equal(data.items[0].before, null)
    assert.equal(data.items[0].after.position_id, positionId)
    assert.equal(data.items[2].context.kind, 'normal')
    assert.equal(data.items[4].before.scheduled_at, 20000)
    assert.equal(data.items[4].after.scheduled_at, 24000)
    assert.equal(data.items[7].reason, 'Availability changed')
    assert.equal(data.items[8].before, null)
    assert.equal(data.items[8].after.recommendation, 'not_recommend')
    assert.equal(data.items[8].after.submitted_at, 25000)
    const positionHistory = history.byPosition(f.context, positionId)
    assert.deepEqual(types(positionHistory), [
      'position_created',
      'position_updated',
      'position_status_changed',
      'position_deleted'
    ])
    assert.equal(positionHistory.items[0].after.title, createPosition.title)
    assert.equal(positionHistory.items[1].before.title, createPosition.title)
    assert.equal(positionHistory.items[1].after.title, rename)
    assert.deepEqual(types(history.byPosition(f.context, otherPosition)), ['position_created'])
    assert.deepEqual(types(history.byApplication(f.context, otherCandidate)), ['candidate_created'])

    const traverse = (eventType) => {
      const ids = []
      let after
      do {
        const page = history.byApplication(f.context, candidateId, { limit: 1, after, eventType })
        ids.push(...page.items.map((item) => item.eventId))
        after = page.nextCursor
        if (after) assert.equal(after.occurredAt, 25000)
      } while (after)
      return ids
    }
    assert.deepEqual(
      traverse(),
      persisted.map((row) => row.id)
    )
    assert.deepEqual(traverse('interview_scheduled'), [persisted[3].id, persisted[6].id])
    assert.equal(
      history.byApplication(f.context, candidateId, { eventType: 'offer_sent' }).nextCursor,
      null
    )
  })
})

test('DEV-10 waiver and supplement preserve original evidence and report a separate later fact', (t) => {
  const f = readFixture(t)
  let now = 10000
  t.mock.method(Date, 'now', () => now)
  const old = f.interview(f.candidateId)
  const reason = 'Advance despite the unavailable evaluation'
  f.advance({ reason })
  const history = createHistoryService(f.dependencies)
  const query = () => history.byApplication(f.context, f.candidateId, { limit: 1 })
  const original = query().items[0]
  assert.equal(original.reason, reason)
  assert.equal(original.actorUserId, 1)
  assert.equal(original.occurredAt, 10000)
  assert.equal(original.before.stage, 'first_interview')
  assert.equal(original.after.stage, 'second_interview')
  assert.deepEqual(original.context.missingInterviews, [
    { interviewId: old, stageScope: 'first_interview' }
  ])
  assert.equal(original.context.kind, 'missing_feedback')
  assert.equal(original.missingFeedbackLinks[0].supplementEventId, null)
  assert.equal(history.historicalMissing(f.context, f.candidateId)[0].historicalMissing, true)

  now = 20000
  f.run(f.feedback, 'feedback.supplement', evaluation(old))
  const supplemented = query()
  const decision = supplemented.items[0]
  const [supplement] = history.byApplication(f.context, f.candidateId, {
    after: supplemented.nextCursor
  }).items
  assert.equal(supplement.eventType, 'feedback_supplemented')
  assert.equal(supplement.context.waiverEventId, original.eventId)
  assert.equal(supplement.occurredAt, 20000)
  assert.deepEqual(decision.missingFeedbackLinks, [
    {
      interviewId: old,
      stageScope: 'first_interview',
      supplementEventId: supplement.eventId,
      supplementedAt: 20000,
      supplementActorUserId: 1,
      supplementActorNameSnapshot: 'Test HR'
    }
  ])
  const { missingFeedbackLinks: _links, ...persisted } = decision
  const { missingFeedbackLinks: _oldLinks, ...before } = original
  assert.deepEqual(persisted, before)
  const [current] = history.historicalMissing(f.context, f.candidateId)
  assert.equal(current.historicalMissing, false)
  assert.equal(current.supplementEventId, supplement.eventId)
  assert.equal(current.waivers[0].eventId, decision.eventId)

  const closed = f.candidate()
  const oldClosed = f.interview(closed)
  f.run(f.advancement, 'application.advance', { reason }, closed)
  f.run(f.offers, 'application.close', terminal, closed)
  const [closedMissing] = history.historicalMissing(f.context, closed)
  assert.equal(closedMissing.interviewId, oldClosed)
  assert.equal(closedMissing.historicalMissing, true)
  assert.equal(closedMissing.canSupplement, false)
  assert.equal(closedMissing.blockedReason, 'APPLICATION_CLOSED')
  assert.throws(() => f.run(f.feedback, 'feedback.supplement', evaluation(oldClosed), closed), {
    code: 'APPLICATION_CLOSED'
  })
})

test('DEV-10 correction retains full before/after snapshots and original decision and closure order', (t) => {
  const f = readFixture(t)
  let now = 10000
  t.mock.method(Date, 'now', () => now)
  const id = f.interview(f.candidateId)
  const submitted = f.run(f.feedback, 'feedback.submit', evaluation(id))
  const feedbackRow = () => ({
    ...f.db.prepare('SELECT * FROM feedback WHERE id=?').get(submitted.feedbackId)
  })
  const before = feedbackRow()
  now = 15000
  f.advance()
  f.run(f.offers, 'application.close', terminal)
  insert(f.db, 'users', {
    id: 2,
    username: 'second-hr',
    password_hash: 'fixture-hash',
    name: 'Second HR',
    role: 'hr',
    department: 'Test',
    email: 'hr2@example.invalid',
    phone: 'test'
  })
  const other = {}
  f.sessions.set(other, 2)
  const correctionReason = 'Correct transcription against the original review'
  f.feedback.execute(
    other,
    f.request('feedback.correct', {
      interview_id: id,
      feedback_revision: 1,
      recommendation: 'recommend',
      reviewer_name: 'Corrected reviewer',
      reason: 'Corrected rationale',
      correction_reason: correctionReason
    })
  )
  const history = createHistoryService(f.dependencies)
  const timeline = history.byApplication(f.context, f.candidateId)
  assert.deepEqual(types(timeline), [
    'feedback_submitted',
    'stage_advanced',
    'application_closed',
    'feedback_corrected'
  ])
  const [original, advancement, closure, correction] = timeline.items
  assert.equal(original.after.recommendation, 'not_recommend')
  assert.deepEqual(original.after, before)
  assert.equal(advancement.context.kind, 'normal')
  assert.deepEqual(advancement.context.completedInterviewIds, [id])
  assert.equal(correction.occurredAt, closure.occurredAt)
  assert(correction.aggregateVersion > closure.aggregateVersion)
  assert.deepEqual(correction.priorDecisions, {
    advancementEventId: advancement.eventId,
    closureEventId: closure.eventId
  })
  assert.deepEqual(correction.before, before)
  assert.deepEqual(correction.after, feedbackRow())
  assert.equal(correction.after.submitted_at, 10000)
  assert.equal(correction.after.recorded_by_user_id, 1)
  assert.equal(correction.reason, correctionReason)
  assert.equal(correction.actorNameSnapshot, 'Second HR')
  assert.equal(correction.actorUserId, 2)
  assert.deepEqual(
    history.byApplication(f.context, f.candidateId, { eventType: 'feedback_corrected' }).items,
    [correction]
  )
})

test('DEV-10 Offer events show only actual commands and one event for the atomic decline', (t) => {
  const f = readFixture(t)
  const history = createHistoryService(f.dependencies)
  const activeWithoutHistory = f.candidate({ stage: 'offer', offer_status: 'accepted' })
  assert.deepEqual(history.byApplication(f.context, activeWithoutHistory).items, [])
  f.advance({ reason: 'Skip initial evaluation' })
  f.advance({ reason: 'Skip secondary evaluation' })
  f.run(f.offers, 'offer.send')
  f.run(f.offers, 'offer.accept')
  assert.deepEqual(types(history.byApplication(f.context, f.candidateId)), [
    'stage_advanced',
    'stage_advanced',
    'offer_sent',
    'offer_accepted'
  ])
  f.run(f.offers, 'offer.confirmHire', { reason: 'HR confirmed' })
  const data = history.byApplication(f.context, f.candidateId)
  assert.equal(data.items[0].context.kind, 'skip_evaluation')
  assert.equal(data.items.at(-1).eventType, 'candidate_hired')
  assert.equal(data.items.at(-1).after.outcome, 'hired')
  const declining = f.candidate({ stage: 'offer', offer_status: 'preparing' })
  f.run(f.offers, 'offer.send', {}, declining)
  f.run(f.offers, 'offer.decline', { reason: 'Candidate declined' }, declining)
  const result = history.byApplication(f.context, declining)
  assert.deepEqual(types(result), ['offer_sent', 'offer_declined'])
  assert.deepEqual(
    [
      result.items[1].after.application_status,
      result.items[1].after.offer_status,
      result.items[1].after.outcome
    ],
    ['closed', 'declined', 'offer_declined']
  )
})

test('DEV-10 archived records preserve unknown facts and remain separate from live applications', (t) => {
  const f = readFixture(t)
  const history = createHistoryService(f.dependencies)
  const dashboard = createDashboardService(f.dependencies)
  const baseline = dashboard.summary(f.context).applicationTotals
  f.legacy({ legacy_id: f.candidateId })
  f.legacy({
    legacy_id: 2,
    mapping_status: 'unique_match',
    mapped_position_id: f.firstPosition,
    raw_json: '{"stage":"offer"}',
    facts_json: '{"stage":"offer","application_status":null,"offer_status":null,"closed_at":null}'
  })
  f.legacy({
    legacy_id: 2,
    entity_type: 'interviews',
    mapping_status: 'not_applicable',
    raw_json: '{"status":"completed","candidate_id":2}',
    facts_json: '{"status":"completed","stage_scope":null,"scheduled_at":null,"completed_at":null}'
  })
  f.legacy({ source_key: 'another-source', legacy_id: f.candidateId, mapping_status: 'ambiguous' })
  const archived = (legacyId, entityType = 'candidates', sourceKey = 'synthetic-v2') =>
    history.legacyRecord(f.context, { sourceKey, entityType, legacyId })
  assertReadOnly(f.db, () => {
    const rejected = archived(f.candidateId)
    assert.equal(rejected.historyStatus, 'history_unknown')
    assert.equal(rejected.mappingStatus, 'no_match')
    assert.equal(rejected.mappedPositionId, null)
    assert.deepEqual(rejected.raw, { stage: 'rejected' })
    assert.deepEqual(rejected.facts, {
      application_status: 'closed',
      outcome: 'company_rejected',
      stage: null,
      closed_at: null,
      closed_reason: null
    })
    assert.equal(rejected.importedAt, 20)
    assert.equal('occurredAt' in rejected, false)
    assert.equal(archived(f.candidateId, 'candidates', 'another-source').mappingStatus, 'ambiguous')
    assert.equal(archived(2).mappedPositionId, f.firstPosition)
    assert.equal(archived(2).facts.offer_status, null)
    assert.equal(archived(2, 'interviews').facts.completed_at, null)
    assert.equal(archived(2, 'interviews').facts.stage_scope, null)
    assert.deepEqual(history.byApplication(f.context, f.candidateId).items, [])
    assert.deepEqual(history.byPosition(f.context, f.firstPosition).items, [])
    assert.deepEqual(dashboard.summary(f.context).applicationTotals, baseline)
    assert.throws(() => history.byApplication(f.context, 2), { code: 'AGGREGATE_NOT_FOUND' })
  })
})

test('DEV-10 every query authenticates a current recruiting role and rejects unsafe inputs', (t) => {
  const f = readFixture(t)
  const history = createHistoryService(f.dependencies)
  const dashboard = createDashboardService(f.dependencies)
  const key = { sourceKey: 'synthetic-v2', entityType: 'candidates', legacyId: 1 }
  f.legacy()
  const queries = [
    (context) => dashboard.summary(context),
    (context) => dashboard.todayInterviews(context),
    (context) => dashboard.workItems(context, 'screening'),
    (context) => dashboard.offerWorkItems(context, 'preparing'),
    (context) => history.byApplication(context, f.candidateId),
    (context) => history.byPosition(context, f.firstPosition),
    (context) => history.historicalMissing(context, f.candidateId),
    (context) => history.legacyRecord(context, key)
  ]
  const missingUser = {}
  f.sessions.set(missingUser, 9999)
  for (const query of queries) {
    assert.throws(() => query({}), { code: 'INVALID_ACTOR' })
    assert.throws(() => query({ id: 1, actorUserId: 1, name: 'Test HR', role: 'hr' }), {
      code: 'INVALID_ACTOR'
    })
    assert.throws(() => query(missingUser), { code: 'INVALID_ACTOR' })
    assert.doesNotThrow(() => query(f.context))
  }
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1")
  for (const query of queries) assert.throws(() => query(f.context), { code: 'FORBIDDEN' })
  f.db.exec("UPDATE users SET role='admin' WHERE id=1")
  const context = f.context
  for (const id of [0, -1, '1', 1.5, Infinity]) {
    assert.throws(() => history.byApplication(context, id), { code: 'INVALID_ID' })
    assert.throws(() => history.byPosition(context, id), { code: 'INVALID_ID' })
    assert.throws(() => history.historicalMissing(context, id), { code: 'INVALID_ID' })
  }
  const bad = [
    () => dashboard.workItems(context, 'constructor'),
    () => dashboard.workItems(context, 'offer', { status: "' OR 1=1 --" }),
    () => dashboard.workItems(context, 'scheduling', { offset: -1 }),
    () => dashboard.workItems(context, 'scheduling', { offset: 100_001 }),
    () => dashboard.workItems(context, 'screening', { limit: 101 }),
    () => dashboard.workItems(context, 'screening', { sort: 'id; SELECT 1' }),
    () => dashboard.offerWorkItems(context, 'declined'),
    () => dashboard.offerWorkItems(context, 'sent', { status: 'preparing' }),
    () => history.byApplication(context, f.candidateId, { limit: 0 }),
    () => history.byApplication(context, f.candidateId, { after: { occurredAt: 1, eventId: -1 } }),
    () => history.byApplication(context, f.candidateId, { sort: 'id' }),
    () => history.byPosition(context, f.firstPosition, { eventType: 'candidate_created' }),
    () => history.legacyRecord(context, { ...key, entityType: 'users' })
  ]
  for (const query of bad) assert.throws(query, { code: 'INVALID_QUERY' })
  assert.equal(f.db.isTransaction, false)
  f.db.exec('BEGIN IMMEDIATE')
  try {
    assert.throws(() => history.byApplication(context, f.candidateId), {
      code: 'QUERY_TRANSACTION_ACTIVE'
    })
    assert.throws(() => dashboard.summary(context), { code: 'QUERY_TRANSACTION_ACTIVE' })
    assert.equal(f.db.isTransaction, true)
  } finally {
    f.db.exec('ROLLBACK')
  }
})
