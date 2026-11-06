import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { createV3App } from '../server/app-v3.js'
import { fixture, insert } from './helpers/v3-db.js'

const password = 'fictional-decision-http-password'
const appointmentTime = '2026-11-06T14:00:00+08:00'
const position = {
  title: 'Fixture role',
  department: 'Test',
  location: 'Shanghai',
  publishDate: '2026-11-06',
  description: 'Fictional'
}
const evaluation = {
  reviewerName: 'Fixture reviewer',
  recommendation: 'not_recommend',
  reason: 'Fixture assessment'
}
const waiverReason = 'Fixture HR documented the missing feedback'
const outcome = 'company_rejected'
const noLeaks = (event) => {
  for (const key of [
    'context',
    'context_json',
    'old_values_json',
    'new_values_json',
    'actor_user_id'
  ])
    assert.ok(!Object.hasOwn(event, key), key)
  for (const row of [event.before, event.after]) {
    assert.deepEqual(Object.keys(row).sort(), [
      'applicationId',
      'applicationStatus',
      'closedAt',
      'closedReason',
      'offerStatus',
      'outcome',
      'stage',
      'version'
    ])
  }
}
const failure = (res, status, code) => {
  assert.equal(res.status, status, JSON.stringify(res.data))
  assert.deepEqual(Object.keys(res.data.error).sort(), ['code', 'message', 'requestId'])
  assert.equal(res.data.error.code, code)
  assert.equal(res.data.error.requestId, res.headers.get('x-request-id'))
}
const success = (res, status = 200) => {
  assert.equal(res.status, status, JSON.stringify(res.data))
  return res.data
}

const setup = async (t) => {
  const f = fixture(t)
  const hash = bcrypt.hashSync(password, 4)
  f.db.prepare("UPDATE users SET password_hash=?,role='hr' WHERE id=1").run(hash)
  insert(f.db, 'users', {
    id: 2,
    username: 'decision-viewer',
    password_hash: hash,
    name: 'Fixture Viewer',
    role: 'viewer',
    department: '',
    email: '',
    phone: ''
  })
  const app = createV3App({ db: f.db, authConfig: { jwtSecret: randomBytes(32).toString('hex') } })
  const server = app.listen(0, '127.0.0.1')
  t.after(
    () =>
      new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  )
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const request = async (path, { method = 'GET', token, body, key } = {}) => {
    const headers = {}
    if (token) headers.Authorization = 'Bearer ' + token
    if (key !== undefined) headers['Idempotency-Key'] = key
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(base + path, { method, headers, body: JSON.stringify(body) })
    return { status: res.status, headers: res.headers, data: await res.json() }
  }
  const login = async (username) =>
    success(
      await request('/auth/login', {
        method: 'POST',
        body: { username, password }
      })
    ).token
  const token = await login('hr-test')
  const get = (path) => request(path, { token })
  const post = (path, body, key = randomUUID()) =>
    request(path, { method: 'POST', token, body, key })
  const resource = (applicationId) => {
    const path = '/applications/' + applicationId
    return {
      get: (suffix = '') => get(path + suffix),
      post: (suffix, body, key) => post(path + suffix, body, key)
    }
  }
  const create = async (positionId = f.firstPosition) => {
    const result = success(
      await post('/applications', {
        positionId,
        name: 'Fixture Candidate',
        owner: 'Fixture HR',
        appliedDate: '2026-11-06',
        email: 'fixture-private@example.invalid',
        note: 'private fixture note'
      }),
      201
    ).result
    return { ...resource(result.aggregateId), id: result.aggregateId }
  }
  const audit = () =>
    ['business_events', 'command_receipts', 'advancement_missing_feedback'].map(
      (table) => f.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n
    )
  return { ...f, request, login, get, post, token, create, audit }
}

test('E3-API-04 protects all twelve decision endpoints and rechecks current recruiting role', async (t) => {
  const f = await setup(t)
  const viewer = await f.login('decision-viewer')
  const reads = [
    '/advance/preflight',
    '/advancement/history',
    '/offer',
    '/offer/preflight',
    '/offer/history',
    '/closure/preflight'
  ]
  const writes = [
    '/advance',
    '/offer/send',
    '/offer/accept',
    '/offer/decline',
    '/offer/confirm-hire',
    '/close'
  ]
  for (const [method, suffixes] of [
    ['GET', reads],
    ['POST', writes]
  ]) {
    for (const suffix of suffixes) {
      const path = '/applications/1' + suffix
      failure(await f.request(path, { method }), 401, 'AUTH_REQUIRED')
      failure(await f.request(path, { method, token: viewer }), 403, 'FORBIDDEN')
    }
  }
  const a = await f.create()
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1")
  failure(await a.get('/advance/preflight'), 403, 'FORBIDDEN')
  failure(await a.post('/advance', { expectedVersion: 1 }), 403, 'FORBIDDEN')
  assert.deepEqual(f.audit(), [1, 1, 0])
})

test('E3-API-04 runs the full cross-API hiring flow with actual waiver and supplement events', async (t) => {
  const f = await setup(t)
  const p = success(await f.post('/positions', position), 201).result
  const a = await f.create(p.aggregateId)
  let version = 1
  const action = async (path, fields = {}, status = 200) => {
    const result = success(
      await a.post(path, { expectedVersion: version, ...fields }),
      status
    ).result
    assert.equal(result.version, ++version)
    return result
  }
  const screening = success(await a.get('/advance/preflight'))
  assert.deepEqual(
    [screening.fromStage, screening.toStage, screening.canAdvance, screening.reasonRequired],
    ['screening', 'first_interview', true, false]
  )
  await action('/advance', { targetStage: 'first_interview' })
  const i = await action(
    '/interviews',
    { scheduledAt: appointmentTime, interviewerName: 'Fixture' },
    201
  )
  await action('/interviews/' + i.interviewId + '/reschedule', {
    interviewVersion: 1,
    scheduledAt: '2026-11-06T14:30:00+08:00'
  })
  await action('/interviews/' + i.interviewId + '/complete', { interviewVersion: 2 })
  await action('/interviews/' + i.interviewId + '/feedback', evaluation, 201)
  const evaluated = success(await a.get('/advance/preflight'))
  assert.equal(evaluated.canAdvance, true)
  assert.equal(evaluated.completed[0].recommendation, 'not_recommend')
  assert.ok(!Object.hasOwn(evaluated.completed[0], 'note'))
  await action('/advance', { targetStage: 'second_interview' })
  const second = await action(
    '/interviews',
    { scheduledAt: appointmentTime, interviewerName: 'Fixture' },
    201
  )
  await action('/interviews/' + second.interviewId + '/complete', { interviewVersion: 1 })
  const missing = success(await a.get('/advance/preflight'))
  assert.deepEqual(
    [
      missing.canAdvance,
      missing.canAdvanceWithReason,
      missing.reasonRequired,
      missing.reasonType,
      missing.missingInterviewIds
    ],
    [false, true, true, 'missing_feedback', [second.interviewId]]
  )
  failure(
    await a.post('/advance', { expectedVersion: version, reason: ' ' }),
    422,
    'ADVANCEMENT_REASON_REQUIRED'
  )
  await action('/advance', { reason: waiverReason, targetStage: 'offer' })
  const before = success(await a.get('/advancement/history'))
  const waiver = before.at(-1)
  assert.deepEqual(
    [waiver.fromStage, waiver.toStage, waiver.kind, waiver.reason, waiver.actorUserId],
    ['second_interview', 'offer', 'missing_feedback', waiverReason, 1]
  )
  assert.deepEqual(waiver.missingInterviews, [
    { interviewId: second.interviewId, stageScope: 'second_interview' }
  ])
  for (const event of before) noLeaks(event)
  assert.equal(success(await a.get('/offer')).offerStatus, 'preparing')
  assert.equal(success(await a.get('/offer/preflight')).actions.send.allowed, true)
  failure(
    await a.post('/offer/confirm-hire', { expectedVersion: version }),
    409,
    'INVALID_OFFER_STATUS'
  )
  await action('/offer/send')
  await action('/offer/accept')
  const accepted = success(await a.get('/offer'))
  assert.deepEqual(
    [accepted.offerStatus, accepted.applicationStatus, accepted.outcome],
    ['accepted', 'active', null]
  )
  const secondPath = '/interviews/' + second.interviewId
  assert.equal(success(await a.get(secondPath + '/supplement-eligibility')).canSupplement, true)
  const feedback = await action(secondPath + '/feedback/supplement', evaluation, 201)
  await action('/offer/confirm-hire')
  const hired = success(await a.get('/offer'))
  assert.deepEqual(
    [hired.stage, hired.offerStatus, hired.applicationStatus, hired.outcome, hired.version],
    ['offer', 'accepted', 'closed', 'hired', version]
  )
  assert.ok(hired.closedAt >= waiver.occurredAt)
  assert.equal(hired.closedReason, 'HR 确认录用')
  assert.deepEqual(success(await a.get('/advancement/history')), before)
  const [supplement] = success(await a.get('/feedback/' + feedback.feedbackId + '/history'))
  assert.deepEqual(
    [supplement.eventType, supplement.waiverEventId, supplement.actorUserId],
    ['feedback_supplemented', waiver.eventId, 1]
  )
  const offerEvents = success(await a.get('/offer/history'))
  assert.deepEqual(
    offerEvents.map((e) => e.eventType),
    ['offer_sent', 'offer_accepted', 'candidate_hired']
  )
  assert.equal(offerEvents.at(-1).reasonSource, 'system_default')
  for (const event of offerEvents) noLeaks(event)
  const events = f.db
    .prepare(
      'SELECT event_type,aggregate_version FROM business_events WHERE candidate_id=? ORDER BY aggregate_version'
    )
    .all(a.id)
  assert.deepEqual(
    events.map((e) => e.event_type),
    [
      'candidate_created',
      'stage_advanced',
      'interview_scheduled',
      'interview_rescheduled',
      'interview_completed',
      'feedback_submitted',
      'stage_advanced',
      'interview_scheduled',
      'interview_completed',
      'stage_advanced',
      'offer_sent',
      'offer_accepted',
      'feedback_supplemented',
      'candidate_hired'
    ]
  )
  assert.deepEqual(
    events.map((e) => e.aggregate_version),
    Array.from({ length: version }, (_, i) => i + 1)
  )
  const [eventCount, receipts, waivers] = f.audit()
  assert.equal(eventCount, receipts)
  assert.equal(waivers, 1)
})

test('E3-API-04 rejects skipped transitions, scheduled appointments and unsafe inputs', async (t) => {
  const f = await setup(t)
  const a = await f.create()
  const before = f.audit()
  failure(
    await a.post('/advance', { expectedVersion: 1, targetStage: 'offer' }),
    422,
    'INVALID_STAGE_TRANSITION'
  )
  failure(await a.post('/advance', { expectedVersion: 1, reason: 9 }), 422, 'INVALID_REASON')
  failure(await a.post('/advance', { expectedVersion: 1, actor: 99 }), 422, 'INVALID_FIELDS')
  failure(await a.post('/advance', { targetStage: 'first_interview' }), 400, 'INVALID_VERSION')
  failure(
    await f.request('/applications/' + a.id + '/advance', {
      method: 'POST',
      token: f.token,
      body: { expectedVersion: 1 }
    }),
    400,
    'INVALID_IDEMPOTENCY_KEY'
  )
  failure(await a.post('/offer/send', { expectedVersion: 1 }), 409, 'INVALID_OFFER_STAGE')
  failure(await f.get('/applications/not-an-id/offer'), 400, 'INVALID_REQUEST')
  failure(await f.get('/applications/99999/offer/history'), 404, 'AGGREGATE_NOT_FOUND')
  assert.deepEqual(f.audit(), before)
  success(await a.post('/advance', { expectedVersion: 1 }))
  failure(
    await a.post('/advance', { expectedVersion: 2, targetStage: 'screening', reason: 'Back' }),
    422,
    'INVALID_STAGE_TRANSITION'
  )
  assert.equal(success(await a.get('/advance/preflight')).reasonType, 'skip_evaluation')
  failure(await a.post('/advance', { expectedVersion: 2 }), 422, 'ADVANCEMENT_REASON_REQUIRED')
  const scheduled = success(
    await a.post('/interviews', {
      expectedVersion: 2,
      scheduledAt: appointmentTime,
      interviewerName: 'Fixture'
    }),
    201
  ).result
  const blocked = success(await a.get('/advance/preflight'))
  assert.equal(blocked.blockedReason, 'SCHEDULED_INTERVIEW_PENDING')
  assert.equal(blocked.scheduled[0].interviewId, scheduled.interviewId)
  assert.equal(
    success(await a.get('/closure/preflight')).pendingInterviews[0].interviewId,
    scheduled.interviewId
  )
  const snapshot = f.audit()
  failure(
    await a.post('/advance', { expectedVersion: 3, reason: 'Try bypass' }),
    409,
    'SCHEDULED_INTERVIEW_PENDING'
  )
  failure(
    await a.post('/close', { expectedVersion: 3, outcome, reason: 'Try bypass' }),
    409,
    'SCHEDULED_INTERVIEW_PENDING'
  )
  assert.deepEqual(f.audit(), snapshot)
  success(
    await a.post('/interviews/' + scheduled.interviewId + '/cancel', {
      expectedVersion: 3,
      interviewVersion: 1,
      reason: 'Fixture cancellation'
    })
  )
  assert.equal(success(await a.get('/advance/preflight')).cancelled[0].status, 'cancelled')
  success(await a.post('/advance', { expectedVersion: 4, reason: 'Skip after cancellation' }))
  assert.equal(success(await a.get('/advancement/history')).at(-1).kind, 'skip_evaluation')
  const completed = success(
    await a.post('/interviews', {
      expectedVersion: 5,
      scheduledAt: appointmentTime,
      interviewerName: 'Fixture'
    }),
    201
  ).result
  success(
    await a.post('/interviews/' + completed.interviewId + '/complete', {
      expectedVersion: 6,
      interviewVersion: 1
    })
  )
  success(
    await a.post('/interviews/' + completed.interviewId + '/feedback', {
      ...evaluation,
      expectedVersion: 7
    }),
    201
  )
  assert.equal(success(await a.get('/advance/preflight')).canAdvance, true)
  success(await a.post('/advance', { expectedVersion: 8 }))
  assert.equal(success(await a.get('/advancement/history')).at(-1).kind, 'normal')
  failure(await a.post('/advance', { expectedVersion: 9 }), 409, 'NO_NEXT_STAGE')
})

const moveTo = async (a, stage, offerStatus) => {
  let version = 1
  for (const targetStage of ['first_interview', 'second_interview', 'offer']) {
    if (stage === 'screening') break
    version = success(
      await a.post('/advance', { expectedVersion: version, targetStage, reason: 'Fixture skip' })
    ).result.version
    if (targetStage === stage) break
  }
  if (['sent', 'accepted'].includes(offerStatus))
    version = success(await a.post('/offer/send', { expectedVersion: version })).result.version
  if (offerStatus === 'accepted')
    version = success(await a.post('/offer/accept', { expectedVersion: version })).result.version
  return version
}

test('E3-API-04 enforces the closure matrix for both outcomes and preserves offer facts', async (t) => {
  const f = await setup(t)
  for (const [stage, offerStatus] of [
    ['screening', null],
    ['first_interview', null],
    ['second_interview', null],
    ['offer', 'preparing'],
    ['offer', 'sent'],
    ['offer', 'accepted']
  ]) {
    for (const result of ['company_rejected', 'candidate_withdrew']) {
      const a = await f.create()
      const version = await moveTo(a, stage, offerStatus)
      const preflight = success(await a.get('/closure/preflight'))
      assert.equal(preflight.allowed, true)
      assert.deepEqual(preflight.allowedOutcomes, ['company_rejected', 'candidate_withdrew'])
      failure(
        await a.post('/close', { expectedVersion: version, outcome: 'hired', reason: 'Invalid' }),
        422,
        'INVALID_CLOSURE_OUTCOME'
      )
      failure(
        await a.post('/close', {
          expectedVersion: version,
          outcome: 'offer_declined',
          reason: 'Invalid'
        }),
        422,
        'INVALID_CLOSURE_OUTCOME'
      )
      failure(
        await a.post('/close', { expectedVersion: version, outcome: result }),
        422,
        'CLOSURE_REASON_REQUIRED'
      )
      success(
        await a.post('/close', {
          expectedVersion: version,
          outcome: result,
          reason: 'Fixture closure'
        })
      )
      const closed = success(await a.get('/offer'))
      assert.deepEqual(
        [
          closed.stage,
          closed.offerStatus,
          closed.applicationStatus,
          closed.outcome,
          closed.version
        ],
        [stage, offerStatus, 'closed', result, version + 1]
      )
      const event = success(await a.get('/offer/history')).at(-1)
      assert.deepEqual(
        [event.eventType, event.before.applicationStatus, event.after.closedAt, event.reasonSource],
        ['application_closed', 'active', closed.closedAt, 'hr_input']
      )
      noLeaks(event)
      for (const action of [
        '/advance',
        '/close',
        '/offer/send',
        '/offer/accept',
        '/offer/decline',
        '/offer/confirm-hire'
      ])
        failure(await a.post(action, { expectedVersion: version + 1 }), 409, 'APPLICATION_CLOSED')
      failure(
        await a.post('/interviews', {
          expectedVersion: version + 1,
          scheduledAt: appointmentTime,
          interviewerName: 'Fixture'
        }),
        409,
        'APPLICATION_CLOSED'
      )
    }
  }
})

test('E3-API-04 version and idempotency checks produce one advancement and one atomic offer decline', async (t) => {
  const f = await setup(t)
  const a = await f.create()
  const key = randomUUID()
  const command = { expectedVersion: 1, targetStage: 'first_interview' }
  const one = success(await a.post('/advance', command, key))
  assert.deepEqual(success(await a.post('/advance', command, key)), { ...one, replayed: true })
  failure(
    await a.post('/advance', { ...command, reason: 'Different' }, key),
    409,
    'IDEMPOTENCY_CONFLICT'
  )
  failure(await a.post('/advance', command), 409, 'VERSION_CONFLICT')
  assert.equal(success(await a.get('/advancement/history')).length, 1)
  success(await a.post('/advance', { expectedVersion: 2, reason: 'Skip' }))
  success(await a.post('/advance', { expectedVersion: 3, reason: 'Skip' }))
  failure(
    await a.post('/offer/decline', { expectedVersion: 4, reason: 'Declined' }),
    409,
    'INVALID_OFFER_STATUS'
  )
  failure(await a.post('/offer/accept', { expectedVersion: 4 }), 409, 'INVALID_OFFER_STATUS')
  success(await a.post('/offer/send', { expectedVersion: 4 }))
  failure(await a.post('/offer/send', { expectedVersion: 5 }), 409, 'INVALID_OFFER_STATUS')
  failure(
    await a.post('/offer/decline', { expectedVersion: 5, reason: ' ' }),
    422,
    'CLOSURE_REASON_REQUIRED'
  )
  const before = f.audit()
  const declineKey = randomUUID()
  const body = { expectedVersion: 5, reason: 'Fixture decline' }
  const declined = success(await a.post('/offer/decline', body, declineKey))
  assert.deepEqual(success(await a.post('/offer/decline', body, declineKey)), {
    ...declined,
    replayed: true
  })
  const state = success(await a.get('/offer'))
  assert.deepEqual(
    [state.offerStatus, state.applicationStatus, state.outcome, state.closedReason, state.version],
    ['declined', 'closed', 'offer_declined', 'Fixture decline', 6]
  )
  const events = success(await a.get('/offer/history'))
  assert.deepEqual(
    events.map((e) => e.eventType),
    ['offer_sent', 'offer_declined']
  )
  assert.equal(events[1].commandId, declined.result.commandId)
  assert.deepEqual(f.audit(), [before[0] + 1, before[1] + 1, before[2]])
})

test('E3-API-04 injected SQLite event, waiver and receipt faults roll back advance and close', async (t) => {
  const f = await setup(t)
  const a = await f.create()
  success(await a.post('/advance', { expectedVersion: 1 }))
  const i = success(
    await a.post('/interviews', {
      expectedVersion: 2,
      scheduledAt: appointmentTime,
      interviewerName: 'Fixture'
    }),
    201
  ).result
  success(
    await a.post('/interviews/' + i.interviewId + '/complete', {
      expectedVersion: 3,
      interviewVersion: 1
    })
  )
  const before = f.audit()
  const inject = (table) =>
    f.db.exec(
      'CREATE TEMP TRIGGER fail_write BEFORE INSERT ON main.' +
        table +
        " BEGIN SELECT RAISE(ABORT,'sensitive SQL canary'); END"
    )
  const key = randomUUID()
  const body = { expectedVersion: 4, reason: waiverReason }
  for (const table of ['business_events', 'advancement_missing_feedback']) {
    inject(table)
    const failed = await a.post('/advance', body, key)
    failure(failed, 500, 'INTERNAL_ERROR')
    assert.doesNotMatch(JSON.stringify(failed.data), /sensitive|canary|SQL/)
    assert.deepEqual(f.audit(), before)
    const state = success(await a.get('/offer'))
    assert.deepEqual([state.stage, state.version], ['first_interview', 4])
    f.db.exec('DROP TRIGGER temp.fail_write')
  }
  success(await a.post('/advance', body, key))
  const committed = f.audit()
  assert.deepEqual(committed, [before[0] + 1, before[1] + 1, before[2] + 1])
  const closeKey = randomUUID()
  const closeBody = { expectedVersion: 5, outcome, reason: 'Fixture closure' }
  inject('command_receipts')
  failure(await a.post('/close', closeBody, closeKey), 500, 'INTERNAL_ERROR')
  const active = success(await a.get('/offer'))
  assert.deepEqual(
    [active.applicationStatus, active.outcome, active.closedAt, active.version],
    ['active', null, null, 5]
  )
  assert.deepEqual(f.audit(), committed)
  f.db.exec('DROP TRIGGER temp.fail_write')
  success(await a.post('/close', closeBody, closeKey))
  assert.deepEqual(f.audit(), [committed[0] + 1, committed[1] + 1, committed[2]])
})
