import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboardService } from '../server/services/dashboard-service.js'
import { parseShanghaiDateTime } from '../server/services/interview-service.js'
import { assertReadOnly, closed, evaluation, readFixture } from './helpers/read-db.js'

const noon = parseShanghaiDateTime('2026-11-03T12:00:00')
const scheduled = (scheduledAt) => ({
  status: 'scheduled',
  scheduled_at: scheduledAt,
  completed_at: null
})
const cancelled = (scheduledAt) => ({
  ...scheduled(scheduledAt),
  status: 'cancelled',
  cancelled_at: 20,
  cancel_reason: 'Cancelled by HR'
})
const dashboard = (f, clock = () => noon) => createDashboardService({ ...f.dependencies, clock })

test('DEV-10 base metrics count records by stable ID and expose soft-deleted open positions', (t) => {
  const f = readFixture(t)
  const sameTitle = f.position()
  f.position({ status: 'closed' })
  f.position({ deleted_at: 20 })
  const first = f.candidate({ stage: 'screening' })
  const second = f.candidate({ stage: 'screening', position_id: sameTitle })
  f.candidate({ stage: 'offer', offer_status: 'accepted' })
  f.candidate({ stage: 'offer', offer_status: 'accepted', ...closed('hired') })
  f.candidate({ stage: 'offer', offer_status: 'accepted', ...closed('candidate_withdrew') })
  f.candidate({ ...closed('company_rejected') })
  const service = dashboard(f)
  const data = service.summary(f.context)
  assert.deepEqual(data.openPositions, { count: 3, unit: 'position_record', softDeletedOpen: 1 })
  assert.deepEqual(data.activeApplications, { count: 4, unit: 'application_record' })
  assert.deepEqual(data.applicationTotals, {
    total: 7,
    active: 4,
    closed: 3,
    hired: 1,
    unit: 'application_record'
  })
  assert.deepEqual(
    service.workItems(f.context, 'screening').items.map((r) => [r.candidateId, r.positionId]),
    [
      [first, f.firstPosition],
      [second, sameTitle]
    ]
  )
})

test('DEV-10 all six work totals align with their sources and current-stage predicates', (t) => {
  const f = readFixture(t)
  const screen = f.candidate({ stage: 'screening' })
  const noInterview = f.candidateId
  const onlyCancelled = f.candidate()
  f.interview(onlyCancelled, cancelled(noon))
  const secondRound = f.candidate({ stage: 'second_interview' })
  f.interview(secondRound)
  const dueCandidate = f.candidate()
  const due = f.interview(dueCandidate, scheduled(noon))
  f.interview(f.candidate(), scheduled(noon + 1))
  const oldScheduled = f.candidate({ stage: 'second_interview' })
  f.interview(oldScheduled, scheduled(noon - 1))
  const twoMissing = f.candidate()
  const missing = [f.interview(twoMissing), f.interview(twoMissing)]
  const ready = f.candidate()
  for (const recommendation of ['not_recommend', 'undecided', 'recommend'])
    f.submit(
      f.interview(ready),
      { recommendation },
      {
        aggregateId: ready,
        expectedVersion: f.db.prepare('SELECT version FROM candidates WHERE id=?').get(ready)
          .version
      }
    )
  const pending = f.candidate()
  f.run(f.feedback, 'feedback.submit', evaluation(f.interview(pending)), pending)
  const pendingAppointment = f.interview(pending, scheduled(noon))
  const partial = f.candidate()
  f.run(f.feedback, 'feedback.submit', evaluation(f.interview(partial)), partial)
  const otherMissing = f.interview(partial)
  const offer = f.candidate({ stage: 'offer', offer_status: 'preparing' })
  f.candidate({ stage: 'screening', ...closed('company_rejected') })
  f.interview(f.candidate(closed('company_rejected')))
  const closedReady = f.candidate()
  f.run(f.feedback, 'feedback.submit', evaluation(f.interview(closedReady)), closedReady)
  f.run(
    f.offers,
    'application.close',
    { outcome: 'candidate_withdrew', reason: 'Candidate opted out' },
    closedReady
  )
  f.candidate(closed('candidate_withdrew'))
  f.candidate({ stage: 'offer', offer_status: 'sent', ...closed('company_rejected') })
  const expected = {
    screening: ['candidateId', [screen]],
    scheduling: ['candidateId', [noInterview, onlyCancelled, secondRound, oldScheduled]],
    due: ['interviewId', [due, pendingAppointment]],
    feedback: ['interviewId', [...missing, otherMissing]],
    decision: ['candidateId', [ready]],
    offer: ['candidateId', [offer]]
  }
  const service = dashboard(f)
  assertReadOnly(f.db, () => {
    const summary = service.summary(f.context)
    for (const [type, [id, ids]] of Object.entries(expected)) {
      const list = service.workItems(f.context, type)
      assert.equal(summary.work[type].count, ids.length, type)
      assert.equal(list.total, summary.work[type].count, type)
      assert.equal(
        list.unit,
        id === 'candidateId' ? 'application_record' : 'interview_record',
        type
      )
      assert.deepEqual(
        list.items.map((item) => item[id]),
        ids,
        type
      )
      for (const item of list.items) {
        assert.equal(item.applicationStatus, 'active')
        assert.equal(item.positionId, f.firstPosition)
        assert.equal(item.type, type)
        assert(item.hint)
        assert(Number.isSafeInteger(item.businessTime))
      }
    }
    const first = service.workItems(f.context, 'feedback', { limit: 1 })
    const last = service.workItems(f.context, 'feedback', { limit: 2, offset: 1 })
    const empty = service.workItems(f.context, 'feedback', { offset: 3 })
    assert.deepEqual(
      [first.total, first.pageCount, last.total, last.pageCount, empty.total, empty.pageCount],
      [3, 1, 3, 2, 3, 0]
    )
    assert.deepEqual(
      [...first.items, ...last.items].map((item) => item.interviewId),
      expected.feedback[1]
    )
    assert.deepEqual(
      first.items.map((item) => item.candidateId),
      [twoMissing]
    )
    assert.equal(last.items[0].candidateId, twoMissing)
  })
})

test('DEV-10 old-round waiver and supplement leave current-round feedback totals unchanged', (t) => {
  const f = readFixture(t)
  const old = f.interview(f.candidateId)
  f.advance({ reason: 'Proceed with documented missing feedback' })
  const current = f.interview(f.candidateId, { stage_scope: 'second_interview' })
  const service = dashboard(f)
  const read = () => {
    assert.equal(service.summary(f.context).work.feedback.count, 1)
    assert.deepEqual(
      service.workItems(f.context, 'feedback').items.map((row) => row.interviewId),
      [current]
    )
  }
  read()
  f.run(f.feedback, 'feedback.supplement', evaluation(old))
  read()
})

test('DEV-10 Offer sources refresh after actual commands and only confirmed hiring is counted', (t) => {
  const f = readFixture(t)
  const service = dashboard(f)
  const preparing = f.candidate({ stage: 'offer', offer_status: 'preparing' })
  const sent = f.candidate({ stage: 'offer', offer_status: 'sent' })
  const accepted = f.candidate({ stage: 'offer', offer_status: 'accepted' })
  f.candidate({ stage: 'offer', offer_status: 'sent', ...closed('company_rejected') })
  f.candidate({ stage: 'offer', offer_status: 'accepted', ...closed('candidate_withdrew') })
  const expect = (ids, hired) => {
    const summary = service.summary(f.context)
    const statuses = ['preparing', 'sent', 'accepted']
    assert.deepEqual(
      summary.offerByStatus,
      Object.fromEntries(statuses.map((status, i) => [status, ids[i].length]))
    )
    assert.equal(summary.work.offer.count, ids.flat().length)
    assert.equal(summary.applicationTotals.hired, hired)
    for (const [i, status] of statuses.entries())
      assert.deepEqual(
        service.offerWorkItems(f.context, status).items.map((row) => row.candidateId),
        ids[i]
      )
  }
  expect([[preparing], [sent], [accepted]], 0)
  f.run(f.offers, 'offer.send', {}, preparing)
  f.run(f.offers, 'offer.decline', { reason: 'Candidate declined' }, sent)
  expect([[], [preparing], [accepted]], 0)
  f.run(f.offers, 'offer.accept', {}, preparing)
  f.run(f.offers, 'offer.confirmHire', { reason: 'Confirmed' }, accepted)
  expect([[], [], [preparing]], 1)
})

test('DEV-10 Shanghai today includes both ends of the day by appointment and groups actual status', (t) => {
  const f = readFixture(t)
  const start = parseShanghaiDateTime('2026-11-03T00:00:00')
  const next = parseShanghaiDateTime('2026-11-04T00:00:00')
  f.interview(f.candidate(), { scheduled_at: start - 1, completed_at: start })
  const end = f.interview(f.candidate(), cancelled(next - 1))
  const beginning = f.interview(f.candidate(), scheduled(start))
  const completed = f.interview(f.candidate(closed('company_rejected')), {
    stage_scope: 'second_interview',
    scheduled_at: noon,
    completed_at: next
  })
  f.interview(f.candidate(), scheduled(next))
  const service = dashboard(f)
  const previous = process.env.TZ
  t.after(() => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  })
  const offsets = new Set()
  for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
    process.env.TZ = tz
    offsets.add(new Date(noon).getTimezoneOffset())
    const today = service.todayInterviews(f.context)
    assert.deepEqual(
      [today.timezone, today.start, today.end, today.total],
      ['Asia/Shanghai', start, next, 3]
    )
    assert.deepEqual(today.byStatus, { scheduled: 1, completed: 1, cancelled: 1 })
    assert.deepEqual(
      today.items.map((r) => r.interviewId),
      [beginning, completed, end]
    )
    assert.equal(service.summary(f.context).todayInterviews.count, 3)
  }
  assert.equal(offsets.size, 3)
})

test('DEV-10 scheduled reminder starts at 14:00:00 exactly without changing interviews or events', (t) => {
  const f = readFixture(t)
  const time = parseShanghaiDateTime('2026-11-03T14:00:00+08:00')
  const id = f.interview(f.candidateId, scheduled(time))
  f.interview(f.candidate(), { scheduled_at: time, completed_at: time })
  f.interview(f.candidate(), cancelled(time))
  let now = time - 1000
  const service = dashboard(f, () => now)
  assertReadOnly(f.db, () => {
    for (const offset of [-1000, 0, 1000]) {
      now = time + offset
      const expected = offset >= 0 ? [id] : []
      assert.deepEqual(
        service
          .todayInterviews(f.context)
          .items.filter((item) => item.due)
          .map((item) => item.interviewId),
        expected
      )
      const due = service.workItems(f.context, 'due').items
      assert.deepEqual(
        due.map((item) => item.interviewId),
        expected
      )
      assert.equal(service.summary(f.context).work.due.count, expected.length)
      if (due.length) assert.equal(due[0].hint, '预约开始时间已到，待确认面试状态')
    }
    for (const invalid of [-1, 0.5, NaN, 8640000000000000, '2026-11-03T14:00:00']) {
      now = invalid
      assert.throws(() => service.summary(f.context), { code: 'INVALID_TIME' })
      assert.throws(() => service.todayInterviews(f.context), { code: 'INVALID_TIME' })
      assert.throws(() => service.workItems(f.context, 'due'), { code: 'INVALID_TIME' })
    }
  })
})
