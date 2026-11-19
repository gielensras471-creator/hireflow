import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { createV3App } from '../server/app-v3.js'
import { createAdvancementService } from '../server/services/advancement-service.js'
import { createOfferService } from '../server/services/offer-service.js'
import { fixture, insert } from './helpers/v3-db.js'

const password = 'fictional-interview-http-password'
const time = Date.parse('2026-11-06T14:00:00+08:00')
const appointment = (applicationId) => '/applications/' + applicationId + '/interviews'
const meeting = (applicationId, interviewId) => appointment(applicationId) + '/' + interviewId
const evaluation = {
  reviewerName: 'Fixture interviewer',
  recommendation: 'recommend',
  reason: 'Fixture assessment'
}

const failure = (res, status, code) => {
  assert.equal(res.status, status, JSON.stringify(res.data))
  assert.equal(res.data.error.code, code)
  assert.deepEqual(Object.keys(res.data.error).sort(), ['code', 'message', 'requestId'])
  assert.equal(res.headers.get('x-request-id'), res.data.error.requestId)
}
const receipt = (res, status) => {
  assert.equal(res.status, status, JSON.stringify(res.data))
  assert.equal(res.data.replayed, false)
  assert.ok(res.data.result.commandId)
  return res.data.result
}
const setup = async (t) => {
  const f = fixture(t)
  const hash = bcrypt.hashSync(password, 4)
  f.db.prepare("UPDATE users SET password_hash=?,role='hr' WHERE id=1").run(hash)
  for (const [id, username, role] of [
    [2, 'fixture-viewer', 'viewer'],
    [3, 'fixture-review-hr', 'hr']
  ]) {
    insert(f.db, 'users', {
      id,
      username,
      role,
      password_hash: hash,
      name: username,
      department: '',
      email: '',
      phone: ''
    })
  }
  const server = createV3App({
    db: f.db,
    authConfig: { jwtSecret: randomBytes(32).toString('hex') }
  }).listen(0, '127.0.0.1')
  t.after(
    () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  )
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const request = async (path, { method = 'GET', token, body, key } = {}) => {
    const headers = {}
    if (token) headers.Authorization = 'Bearer ' + token
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (key !== undefined) headers['Idempotency-Key'] = key
    const response = await fetch(base + path, { method, headers, body: JSON.stringify(body) })
    return { status: response.status, headers: response.headers, data: await response.json() }
  }
  const login = async (username) => {
    const res = await request('/auth/login', { method: 'POST', body: { username, password } })
    assert.equal(res.status, 200)
    return res.data.token
  }
  const token = await login('hr-test')
  const get = (path) => request(path, { token })
  const post = (path, body, key = randomUUID()) =>
    request(path, { method: 'POST', body, key, token })
  const record = (applicationId) =>
    f.db.prepare('SELECT * FROM candidates WHERE id=?').get(applicationId)
  const schedule = (applicationId, scheduledAt = time) =>
    post(appointment(applicationId), {
      expectedVersion: record(applicationId).version,
      scheduledAt,
      interviewerName: 'Fixture interviewer'
    })
  const complete = (applicationId, interviewId) =>
    post(meeting(applicationId, interviewId) + '/complete', {
      expectedVersion: record(applicationId).version,
      interviewVersion: 1
    })
  const audit = () =>
    ['interviews', 'feedback', 'business_events', 'command_receipts'].map(
      (table) => f.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n
    )
  const context = Object.freeze({})
  const options = { db: f.db, resolveActor: (input) => (input === context ? 1 : undefined) }
  const advance = createAdvancementService(options)
  const offer = createOfferService(options)
  const runFixture = (service, command, applicationId, payload) =>
    service.execute(context, {
      command,
      aggregateId: applicationId,
      expectedVersion: record(applicationId).version,
      idempotencyKey: randomUUID(),
      payload
    })
  return {
    ...f,
    request,
    login,
    token,
    get,
    post,
    record,
    schedule,
    complete,
    audit,
    advance: (id) =>
      runFixture(advance, 'application.advance', id, { reason: 'Documented missing feedback' }),
    close: (id) =>
      runFixture(offer, 'application.close', id, {
        outcome: 'candidate_withdrew',
        reason: 'Fixture withdrawal'
      })
  }
}

test('E3-API-03 all thirteen routes enforce Bearer and the current recruiting role', async (t) => {
  const f = await setup(t)
  const viewer = await f.login('fixture-viewer')
  const paths = [
    ['GET', '/interviews'],
    ['GET', '/interviews/1'],
    ['GET', appointment(1)],
    ['POST', appointment(1)],
    ['POST', meeting(1, 1) + '/reschedule'],
    ['POST', meeting(1, 1) + '/complete'],
    ['POST', meeting(1, 1) + '/cancel'],
    ['GET', '/applications/1/feedback'],
    ['GET', meeting(1, 1) + '/supplement-eligibility'],
    ['GET', '/applications/1/feedback/1/history'],
    ['POST', meeting(1, 1) + '/feedback'],
    ['POST', meeting(1, 1) + '/feedback/supplement'],
    ['POST', meeting(1, 1) + '/feedback/correct']
  ]
  for (const [method, path] of paths) {
    failure(await f.request(path, { method }), 401, 'AUTH_REQUIRED')
    failure(await f.request(path, { method, token: viewer }), 403, 'FORBIDDEN')
  }
  assert.equal((await f.get('/interviews')).status, 200)
  for (const [method, path] of [
    ['DELETE', '/interviews/1'],
    ['POST', '/applications/1/reopen'],
    ['DELETE', '/applications/1']
  ])
    failure(await f.request(path, { method, token: f.token }), 404, 'NOT_FOUND')
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1")
  failure(await f.get('/interviews'), 403, 'FORBIDDEN')
  failure(
    await f.post(meeting(1, 1) + '/feedback', { ...evaluation, expectedVersion: 1 }),
    403,
    'FORBIDDEN'
  )
  assert.deepEqual(f.audit(), [0, 0, 0, 0])
})

test('E3-API-03 interview writes enforce Shanghai times, dual versions and independent lifecycle', async (t) => {
  let now = time - 1000
  t.mock.method(Date, 'now', () => now)
  const f = await setup(t)
  const first = f.candidate({ stage: 'first_interview' })
  const second = f.candidate({ stage: 'second_interview' })
  const screening = f.candidate({ stage: 'screening' })
  failure(await f.schedule(screening), 409, 'INVALID_INTERVIEW_STAGE')
  failure(await f.schedule(first, '2026-02-30T14:00:00'), 422, 'INVALID_TIME')
  failure(await f.schedule(first, '2026-11-06T14:00:00Z'), 422, 'INVALID_TIME')
  failure(
    await f.post(appointment(first), {
      expectedVersion: 1,
      scheduledAt: time,
      interviewerName: 'Fixture',
      stageScope: 'second_interview'
    }),
    422,
    'INVALID_FIELDS'
  )
  const { interviewId: id } = receipt(await f.schedule(first, '2026-11-06T14:00:00'), 201)
  const detail = async () => (await f.get('/interviews/' + id)).data
  const initial = await detail()
  assert.deepEqual(
    [
      initial.scheduledAt,
      initial.scheduledLocal,
      initial.businessTimeZone,
      initial.stageScope,
      initial.applicationVersion,
      initial.interviewVersion
    ],
    [time, '2026-11-06T14:00:00+08:00', 'Asia/Shanghai', 'first_interview', 2, 1]
  )
  const before = f.audit()
  for (const offset of [-1000, 0, 1000]) {
    now = time + offset
    const row = await detail()
    assert.equal(row.startTimeReached, offset >= 0)
    assert.equal(row.status, 'scheduled')
    assert.equal(row.completedAt, null)
  }
  assert.deepEqual(f.audit(), before)
  failure(await f.schedule(first), 409, 'INTERVIEW_ALREADY_SCHEDULED')
  const reschedule = meeting(first, id) + '/reschedule'
  failure(
    await f.post(reschedule, { expectedVersion: 1, interviewVersion: 1, scheduledAt: time + 1000 }),
    409,
    'VERSION_CONFLICT'
  )
  failure(
    await f.post(reschedule, { expectedVersion: 2, interviewVersion: 2, scheduledAt: time + 1000 }),
    409,
    'INTERVIEW_VERSION_CONFLICT'
  )
  failure(
    await f.post(reschedule, { expectedVersion: 2, scheduledAt: time + 1000 }),
    400,
    'INVALID_INTERVIEW_VERSION'
  )
  const key = randomUUID()
  const body = { expectedVersion: 2, interviewVersion: 1, scheduledAt: '2026-11-06T14:01:00+08:00' }
  const moved = await f.post(reschedule, body, key)
  assert.equal(receipt(moved, 200).interviewVersion, 2)
  assert.deepEqual((await f.post(reschedule, body, key)).data, { ...moved.data, replayed: true })
  failure(
    await f.post(reschedule, { ...body, scheduledAt: time }, key),
    409,
    'IDEMPOTENCY_CONFLICT'
  )
  assert.equal((await detail()).scheduledAt, time + 60000)
  failure(
    await f.post(meeting(second, id) + '/complete', { expectedVersion: 1, interviewVersion: 2 }),
    404,
    'INTERVIEW_ASSOCIATION_CONFLICT'
  )
  receipt(
    await f.post(meeting(first, id) + '/complete', { expectedVersion: 3, interviewVersion: 2 }),
    200
  )
  assert.equal(f.record(first).stage, 'first_interview')
  assert.equal((await detail()).status, 'completed')
  assert.equal((await detail()).startTimeReached, false)
  failure(
    await f.post(meeting(first, id) + '/cancel', {
      expectedVersion: 4,
      interviewVersion: 3,
      reason: 'Fixture'
    }),
    409,
    'INTERVIEW_NOT_SCHEDULED'
  )
  const later = receipt(await f.schedule(first), 201)
  failure(
    await f.post(meeting(first, later.interviewId) + '/cancel', {
      expectedVersion: 5,
      interviewVersion: 1,
      reason: ' '
    }),
    422,
    'CANCEL_REASON_REQUIRED'
  )
  receipt(
    await f.post(meeting(first, later.interviewId) + '/cancel', {
      expectedVersion: 5,
      interviewVersion: 1,
      reason: 'Fixture cancellation'
    }),
    200
  )
  assert.equal(
    (await f.get('/interviews/' + later.interviewId)).data.cancelReason,
    'Fixture cancellation'
  )
  const next = receipt(await f.schedule(second), 201)
  assert.equal((await f.get('/interviews/' + next.interviewId)).data.stageScope, 'second_interview')
  const events = f.db
    .prepare(
      'SELECT event_type FROM business_events WHERE candidate_id=? ORDER BY aggregate_version'
    )
    .all(first)
  assert.deepEqual(
    events.map(({ event_type }) => event_type),
    [
      'interview_scheduled',
      'interview_rescheduled',
      'interview_completed',
      'interview_scheduled',
      'interview_cancelled'
    ]
  )
})

test('E3-API-03 interview SQL pages filter and sort stably with scoped reads and public DTOs', async (t) => {
  const f = await setup(t)
  const ids = []
  const applications = [
    f.candidate({ stage: 'second_interview' }),
    f.candidate({ stage: 'second_interview' }),
    f.candidate({ stage: 'first_interview' })
  ]
  for (const [i, id] of applications.entries())
    ids.push(receipt(await f.schedule(id, i === 0 ? time + 1000 : time), 201).interviewId)
  const page = (
    await f.get(
      '/interviews?stageScope=second_interview&status=scheduled&positionId=' +
        f.firstPosition +
        '&limit=1&offset=1'
    )
  ).data
  assert.deepEqual(
    [page.items.map((row) => row.id), page.total, page.limit, page.offset],
    [[ids[0]], 2, 1, 1]
  )
  const all = (await f.get('/interviews')).data
  assert.deepEqual(
    all.items.map((row) => row.id),
    [ids[1], ids[2], ids[0]]
  )
  assert.equal(all.limit, 50)
  const scoped = (await f.get(appointment(applications[0]))).data
  assert.deepEqual(
    scoped.map((row) => row.id),
    [ids[0]]
  )
  assert.equal(scoped[0].applicationId, applications[0])
  assert.equal('candidate_id' in scoped[0], false)
  assert.equal('phone' in scoped[0], false)
  for (const q of [
    'status=other',
    'stageScope=offer',
    'limit=101',
    'offset=-1',
    'applicationId=1.5',
    'positionId=0',
    'limit=1&limit=2',
    'q=other'
  ])
    assert.equal((await f.get('/interviews?' + q)).status, 400, q)
  failure(await f.get('/interviews/99999'), 404, 'INTERVIEW_NOT_FOUND')
  failure(await f.get(appointment(99999)), 404, 'AGGREGATE_NOT_FOUND')
})

test('E3-API-03 first feedback and corrections preserve provenance, snapshots and idempotency', async (t) => {
  const f = await setup(t)
  const id = f.candidate({ stage: 'first_interview' })
  const { interviewId } = receipt(await f.schedule(id), 201)
  const path = meeting(id, interviewId) + '/feedback'
  failure(await f.post(path, { ...evaluation, expectedVersion: 2 }), 409, 'INTERVIEW_NOT_COMPLETED')
  receipt(await f.complete(id, interviewId), 200)
  failure(
    await f.post(path, { ...evaluation, expectedVersion: 3, recommendation: 'unknown' }),
    422,
    'INVALID_RECOMMENDATION'
  )
  failure(
    await f.post(path, { ...evaluation, expectedVersion: 3, reason: '' }),
    422,
    'INVALID_FEEDBACK'
  )
  failure(
    await f.post(path, { ...evaluation, expectedVersion: 3, recordedByUserId: 3 }),
    422,
    'INVALID_FIELDS'
  )
  const key = randomUUID()
  const body = { ...evaluation, expectedVersion: 3 }
  const submitted = await f.post(path, body, key)
  const { feedbackId } = receipt(submitted, 201)
  assert.deepEqual((await f.post(path, body, key)).data, { ...submitted.data, replayed: true })
  failure(await f.post(path, { ...body, reason: 'Different' }, key), 409, 'IDEMPOTENCY_CONFLICT')
  failure(await f.post(path, { ...body, expectedVersion: 4 }), 409, 'FEEDBACK_ALREADY_EXISTS')
  assert.equal(f.record(id).stage, 'first_interview')
  const feedbackPath = '/applications/' + id + '/feedback'
  const original = (await f.get(feedbackPath)).data[0]
  assert.equal(original.recordedByUserId, 1)
  assert.equal(original.reviewerName, evaluation.reviewerName)
  f.close(id)
  const correct = path + '/correct'
  const version = f.record(id).version
  const correction = {
    expectedVersion: version,
    feedbackRevision: 1,
    recommendation: 'undecided',
    correctionReason: 'Fix transcription'
  }
  failure(
    await f.post(correct, { ...correction, expectedVersion: version - 1 }),
    409,
    'VERSION_CONFLICT'
  )
  failure(
    await f.post(correct, { ...correction, feedbackRevision: 2 }),
    409,
    'FEEDBACK_REVISION_CONFLICT'
  )
  failure(
    await f.post(correct, { ...correction, feedbackRevision: undefined }),
    400,
    'INVALID_FEEDBACK_REVISION'
  )
  failure(
    await f.post(correct, { ...correction, correctionReason: '' }),
    422,
    'CORRECTION_REASON_REQUIRED'
  )
  failure(await f.post(correct, { ...correction, recommendation: 'recommend' }), 409, 'NO_CHANGE')
  const hr = await f.login('fixture-review-hr')
  const updated = await f.request(correct, {
    token: hr,
    method: 'POST',
    key: randomUUID(),
    body: correction
  })
  assert.equal(receipt(updated, 200).feedbackRevision, 2)
  const edited = (await f.get(feedbackPath)).data[0]
  assert.deepEqual(
    [edited.submittedAt, edited.recordedByUserId, edited.revision, edited.corrected],
    [original.submittedAt, 1, 2, true]
  )
  assert.equal(f.record(id).application_status, 'closed')
  const history = (await f.get(feedbackPath + '/' + feedbackId + '/history')).data
  assert.deepEqual(
    history.map((event) => event.eventType),
    ['feedback_submitted', 'feedback_corrected']
  )
  assert.deepEqual(
    [
      history[1].before.recommendation,
      history[1].after.recommendation,
      history[1].actorUserId,
      history[1].reason
    ],
    ['recommend', 'undecided', 3, 'Fix transcription']
  )
  assert.equal(history[1].before.submittedAt, history[1].after.submittedAt)
  assert.equal(history[1].after.recordedByUserId, 1)
  assert.equal(history[0].before, null)
  for (const event of history)
    for (const field of [
      'context',
      'old_values_json',
      'new_values_json',
      'actor_user_id',
      'command_id'
    ])
      assert.ok(!Object.hasOwn(event, field))
  const other = f.candidate({ stage: 'first_interview' })
  failure(
    await f.get('/applications/' + other + '/feedback/' + feedbackId + '/history'),
    404,
    'FEEDBACK_NOT_FOUND'
  )
})

test('E3-API-03 supplements only real active waivers and links the immutable advancement event', async (t) => {
  const f = await setup(t)
  const id = f.candidate({ stage: 'first_interview' })
  const interviews = []
  for (let i = 0; i < 2; i++) {
    const { interviewId } = receipt(await f.schedule(id), 201)
    receipt(await f.complete(id, interviewId), 200)
    interviews.push(interviewId)
  }
  const [first, second] = interviews.map((i) => meeting(id, i))
  const getEligibility = (path) => f.get(path + '/supplement-eligibility')
  assert.equal((await getEligibility(first)).data.canSupplement, false)
  failure(
    await f.post(first + '/feedback/supplement', {
      ...evaluation,
      expectedVersion: f.record(id).version
    }),
    409,
    'NOT_PAST_INTERVIEW_ROUND'
  )
  f.advance(id)
  const waiver = f.db
    .prepare("SELECT * FROM business_events WHERE candidate_id=? AND event_type='stage_advanced'")
    .get(id)
  const eligible = (await getEligibility(first)).data
  assert.equal(eligible.canSupplement, true)
  assert.equal(eligible.historicalMissing, true)
  assert.deepEqual(
    eligible.waivers.map(({ eventId }) => eventId),
    [waiver.id]
  )
  const version = f.record(id).version
  failure(
    await f.post(first + '/feedback', { ...evaluation, expectedVersion: version }),
    409,
    'HISTORICAL_FEEDBACK_NOT_ALLOWED'
  )
  const { feedbackId } = receipt(
    await f.post(first + '/feedback/supplement', { ...evaluation, expectedVersion: version }),
    201
  )
  const history = (await f.get('/applications/' + id + '/feedback/' + feedbackId + '/history')).data
  assert.deepEqual(
    [history[0].eventType, history[0].waiverEventId, history[0].priorAdvancementEventId],
    ['feedback_supplemented', waiver.id, waiver.id]
  )
  assert.deepEqual(f.db.prepare('SELECT * FROM business_events WHERE id=?').get(waiver.id), waiver)
  assert.equal((await getEligibility(first)).data.supplementEventId, history[0].eventId)
  f.close(id)
  const blocked = (await getEligibility(second)).data
  assert.deepEqual(
    [blocked.canSupplement, blocked.blockedReason, blocked.historicalMissing],
    [false, 'APPLICATION_CLOSED', true]
  )
  failure(
    await f.post(second + '/feedback/supplement', {
      ...evaluation,
      expectedVersion: f.record(id).version
    }),
    409,
    'APPLICATION_CLOSED'
  )
  const noEvidence = f.candidate({ stage: 'second_interview' })
  const old = f.interview(noEvidence, { stage_scope: 'first_interview' })
  const noWaiver = meeting(noEvidence, old)
  assert.equal((await getEligibility(noWaiver)).data.blockedReason, 'HISTORICAL_WAIVER_REQUIRED')
  failure(
    await f.post(noWaiver + '/feedback/supplement', { ...evaluation, expectedVersion: 1 }),
    409,
    'HISTORICAL_WAIVER_REQUIRED'
  )
})

test('E3-API-03 injected event and receipt failures roll back HTTP writes with safe errors', async (t) => {
  const f = await setup(t)
  const id = f.candidate({ stage: 'first_interview' })
  const before = f.audit()
  const trigger = (table) =>
    f.db.exec(
      'CREATE TEMP TRIGGER fail_write BEFORE INSERT ON main.' +
        table +
        " BEGIN SELECT RAISE(ABORT,'sensitive audit canary'); END"
    )
  trigger('business_events')
  const failed = await f.schedule(id)
  failure(failed, 500, 'INTERNAL_ERROR')
  assert.doesNotMatch(JSON.stringify(failed.data), /canary|business_events|stack/)
  assert.deepEqual(f.audit(), before)
  assert.equal(f.record(id).version, 1)
  f.db.exec('DROP TRIGGER temp.fail_write')
  const { interviewId } = receipt(await f.schedule(id), 201)
  receipt(await f.complete(id, interviewId), 200)
  const snapshot = f.audit()
  const body = { ...evaluation, expectedVersion: 3 }
  const key = randomUUID()
  const path = meeting(id, interviewId) + '/feedback'
  trigger('command_receipts')
  failure(await f.post(path, body, key), 500, 'INTERNAL_ERROR')
  assert.equal(f.record(id).version, 3)
  assert.deepEqual(f.audit(), snapshot)
  f.db.exec('DROP TRIGGER temp.fail_write')
  receipt(await f.post(path, body, key), 201)
  assert.deepEqual(f.audit(), [snapshot[0], snapshot[1] + 1, snapshot[2] + 1, snapshot[3] + 1])
})
