import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import { createV3App } from '../server/app-v3.js'
import { fixture, insert } from './helpers/v3-db.js'

const password = 'fictional-dashboard-history-password'
const today = Date.parse('2026-11-06T00:00:00+08:00')
const appointment = Date.parse('2026-11-06T14:00:00+08:00')
const nextDay = Date.parse('2026-11-07T00:00:00+08:00')
const evaluation = {
  reviewerName: 'Fixture reviewer',
  recommendation: 'recommend',
  reason: 'Fixture evaluation'
}
const profileNote = 'private-profile-note-fixture'
const privateEmail = 'candidate-private@example.invalid'

const response = (result, status = 200) => {
  assert.equal(result.status, status, JSON.stringify(result.data))
  return result.data
}
const failure = (result, status, code) => {
  const { error } = response(result, status)
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message', 'requestId'])
  if (code) assert.equal(error.code, code)
  assert.equal(error.requestId, result.headers.get('x-request-id'))
}

const setup = async (t) => {
  const f = fixture(t)
  const hash = bcrypt.hashSync(password, 4)
  f.db.prepare("UPDATE users SET password_hash=?,role='hr' WHERE id=1").run(hash)
  insert(f.db, 'users', {
    id: 2,
    username: 'dashboard-viewer',
    password_hash: hash,
    name: 'Fixture Viewer',
    role: 'viewer',
    department: '',
    email: '',
    phone: ''
  })
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
  const request = async (path, { token, method = 'GET', body } = {}) => {
    const headers = {}
    if (token) headers.Authorization = 'Bearer ' + token
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Idempotency-Key'] = randomUUID()
    }
    const res = await fetch(base + path, { method, headers, body: JSON.stringify(body) })
    return { status: res.status, headers: res.headers, data: await res.json() }
  }
  const login = async (username) =>
    response(
      await request('/auth/login', {
        method: 'POST',
        body: { username, password }
      })
    ).token
  const token = await login('hr-test')
  const get = async (path) => response(await request(path, { token }))
  const write = async (path, body, status, method = 'POST') =>
    response(await request(path, { method, token, body }), status).result
  const position = () =>
    write(
      '/positions',
      {
        title: 'Original fixture title',
        department: 'Test',
        location: 'Shanghai',
        publishDate: '2026-11-06',
        description: 'fixture-position-description'
      },
      201
    )
  const create = async (positionId = f.firstPosition) => {
    const initial = await write(
      '/applications',
      {
        positionId,
        name: 'Same fictional person',
        owner: 'Fixture HR',
        appliedDate: '2026-11-06',
        email: privateEmail,
        phone: 'fixture-private-phone',
        note: profileNote
      },
      201
    )
    const path = '/applications/' + initial.aggregateId
    let version = initial.version
    const action = async (suffix, body = {}, status = 200, method = 'POST') => {
      const result = await write(
        path + suffix,
        { expectedVersion: version, ...body },
        status,
        method
      )
      assert.equal(result.version, ++version)
      return result
    }
    return {
      id: initial.aggregateId,
      get: (suffix = '') => get(path + suffix),
      action,
      advance: (body) => action('/advance', body),
      schedule: (scheduledAt = appointment) =>
        action(
          '/interviews',
          {
            scheduledAt,
            interviewerName: 'Fixture interviewer',
            note: 'private-interview-note-fixture'
          },
          201
        ),
      complete: (id) => action('/interviews/' + id + '/complete', { interviewVersion: 1 }),
      feedback: (id) => action('/interviews/' + id + '/feedback', evaluation, 201)
    }
  }
  return { ...f, request, get, write, login, token, position, create }
}

const moveToOffer = async (application) => {
  await application.advance()
  await application.advance({ reason: 'Fixture skip first round' })
  await application.advance({ reason: 'Fixture skip second round' })
}
const assertReadOnly = async (db, verify) => {
  const tables = [
    'positions',
    'candidates',
    'interviews',
    'feedback',
    'legacy_records',
    'business_events',
    'command_receipts',
    'advancement_missing_feedback'
  ]
  const snapshot = () =>
    tables.map((table) => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())
  const before = snapshot()
  db.exec('PRAGMA query_only=ON')
  try {
    await verify()
    assert.deepEqual(snapshot(), before)
    assert.equal(db.isTransaction, false)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally {
    db.exec('PRAGMA query_only=OFF')
  }
}

test('E3-API-05 all eight GET endpoints enforce current recruiting authorization', async (t) => {
  const f = await setup(t)
  const viewer = await f.login('dashboard-viewer')
  const a = await f.create()
  f.legacy()
  const paths = [
    '/dashboard/summary',
    '/dashboard/work-items/screening',
    '/dashboard/offer-work-items/preparing',
    '/dashboard/today-interviews',
    '/applications/' + a.id + '/history',
    '/positions/' + f.firstPosition + '/history',
    '/applications/' + a.id + '/historical-missing',
    '/legacy-records?sourceKey=synthetic-v2&entityType=candidates&legacyId=1'
  ]
  for (const path of paths) {
    failure(await f.request(path), 401, 'AUTH_REQUIRED')
    failure(await f.request(path, { token: viewer }), 403, 'FORBIDDEN')
  }
  await assertReadOnly(f.db, async () => {
    for (const path of paths)
      assert.equal((await f.request(path, { token: f.token })).status, 200, path)
  })
  f.db.exec("UPDATE users SET role='viewer' WHERE id=1")
  for (const path of paths) failure(await f.request(path, { token: f.token }), 403, 'FORBIDDEN')
})

test('E3-API-05 dashboard metrics and six paged work lists match actual HTTP-written facts', async (t) => {
  t.mock.method(Date, 'now', () => appointment)
  const f = await setup(t)
  const archived = await f.position()
  await f.write('/positions/' + archived.aggregateId + '/archive', {
    expectedVersion: archived.version
  })
  const screening = await f.create()
  const scheduling = await f.create()
  await scheduling.advance()
  const due = await f.create()
  await due.advance()
  const dueInterview = await due.schedule()
  const missing = await f.create()
  await missing.advance()
  const missingIds = []
  for (let i = 0; i < 2; i++) {
    const { interviewId } = await missing.schedule()
    await missing.complete(interviewId)
    missingIds.push(interviewId)
  }
  const decision = await f.create()
  await decision.advance()
  const evaluated = await decision.schedule()
  await decision.complete(evaluated.interviewId)
  await decision.feedback(evaluated.interviewId)
  const old = await f.create()
  await old.advance()
  const oldInterview = await old.schedule()
  await old.complete(oldInterview.interviewId)
  await old.advance({ reason: 'Fixture missing feedback waived' })
  const offers = []
  for (const status of ['preparing', 'sent', 'accepted']) {
    const app = await f.create()
    await moveToOffer(app)
    if (status !== 'preparing') await app.action('/offer/send')
    if (status === 'accepted') await app.action('/offer/accept')
    offers.push(app)
  }
  const summary = () => f.get('/dashboard/summary')
  await assertReadOnly(f.db, async () => {
    const data = await summary()
    assert.equal(data.now, appointment)
    assert.equal(data.timezone, 'Asia/Shanghai')
    assert.deepEqual(data.openPositions, { count: 2, softDeletedOpen: 1, unit: 'position_record' })
    assert.deepEqual(data.activeApplications, { count: 9, unit: 'application_record' })
    assert.deepEqual(data.applicationTotals, {
      total: 9,
      active: 9,
      closed: 0,
      hired: 0,
      unit: 'application_record'
    })
    assert.deepEqual(data.todayInterviews, { count: 5, unit: 'interview_record' })
    assert.deepEqual(data.offerByStatus, { preparing: 1, sent: 1, accepted: 1 })
    const work = {
      screening: [[screening.id, null]],
      scheduling: [
        [scheduling.id, null],
        [old.id, null]
      ],
      due: [[due.id, dueInterview.interviewId]],
      feedback: missingIds.map((id) => [missing.id, id]),
      decision: [[decision.id, null]],
      offer: offers.map((a) => [a.id, null])
    }
    for (const [type, ids] of Object.entries(work)) {
      const list = await f.get('/dashboard/work-items/' + type)
      const unit = ['due', 'feedback'].includes(type) ? 'interview_record' : 'application_record'
      assert.deepEqual(data.work[type], { count: ids.length, unit }, type)
      assert.deepEqual(
        [list.type, list.unit, list.total, list.limit, list.offset, list.pageCount],
        [type, unit, ids.length, 50, 0, ids.length]
      )
      assert.deepEqual(
        list.items.map((item) => [item.applicationId, item.interviewId]),
        ids
      )
      assert.ok(list.items.every((item) => item.hint && item.positionId === f.firstPosition))
    }
    for (const [i, status] of ['preparing', 'sent', 'accepted'].entries()) {
      const list = await f.get('/dashboard/offer-work-items/' + status)
      assert.deepEqual(
        list.items.map((item) => [item.applicationId, item.offerStatus]),
        [[offers[i].id, status]]
      )
    }
    const later = await f.get('/dashboard/work-items/feedback?limit=1&offset=1')
    assert.deepEqual(
      [later.total, later.pageCount, later.items[0].interviewId],
      [2, 1, missingIds[1]]
    )
    const history = await old.get('/historical-missing')
    assert.deepEqual(
      history.map((item) => item.interviewId),
      [oldInterview.interviewId]
    )
  })
  await offers[1].action('/offer/decline', { reason: 'Fixture declined' })
  await offers[2].action('/offer/confirm-hire')
  const final = await summary()
  assert.deepEqual(final.offerByStatus, { preparing: 1, sent: 0, accepted: 0 })
  assert.deepEqual(final.applicationTotals, {
    total: 9,
    active: 7,
    closed: 2,
    hired: 1,
    unit: 'application_record'
  })
  assert.equal((await f.get('/dashboard/offer-work-items/sent')).total, 0)
  assert.equal((await f.get('/dashboard/offer-work-items/accepted')).total, 0)
  const decline = (await offers[1].get('/history?eventType=offer_declined')).items[0]
  assert.deepEqual(
    [
      decline.after.applicationStatus,
      decline.after.offerStatus,
      decline.after.outcome,
      decline.reason
    ],
    ['closed', 'declined', 'offer_declined', 'Fixture declined']
  )
  await old.action('/close', { outcome: 'company_rejected', reason: 'Fixture ordinary closure' })
  const [closure] = (await old.get('/history?eventType=application_closed')).items
  assert.deepEqual(
    [closure.before.stage, closure.after.stage, closure.after.outcome, closure.reason],
    ['second_interview', 'second_interview', 'company_rejected', 'Fixture ordinary closure']
  )
})

test('E3-API-05 Shanghai today pages preserve full totals and exact read-only reminder boundaries', async (t) => {
  let now = appointment - 1000
  t.mock.method(Date, 'now', () => now)
  const f = await setup(t)
  const schedule = async (time, status = 'scheduled') => {
    const a = await f.create()
    await a.advance()
    const { interviewId } = await a.schedule(time)
    if (status === 'completed') await a.complete(interviewId)
    if (status === 'cancelled')
      await a.action('/interviews/' + interviewId + '/cancel', {
        interviewVersion: 1,
        reason: 'Fixture cancellation'
      })
    return interviewId
  }
  await schedule(today - 1, 'completed')
  const start = await schedule(today)
  const completed = await schedule(today + 9 * 3600000, 'completed')
  const cancelled = await schedule(today + 10 * 3600000, 'cancelled')
  const due = await schedule(appointment)
  const end = await schedule(nextDay - 1)
  const tomorrow = await schedule(nextDay)
  const endpoint = '/dashboard/today-interviews'
  await assertReadOnly(f.db, async () => {
    for (const offset of [-1000, 0, 1000]) {
      now = appointment + offset
      const page = await f.get(endpoint)
      assert.deepEqual(
        [page.timezone, page.start, page.end, page.total, page.unit],
        ['Asia/Shanghai', today, nextDay, 5, 'interview_record']
      )
      assert.deepEqual(page.byStatus, { scheduled: 3, completed: 1, cancelled: 1 })
      assert.deepEqual(
        page.items.map((row) => row.interviewId),
        [start, completed, cancelled, due, end]
      )
      const row = page.items.find((item) => item.interviewId === due)
      assert.equal(row.due, offset >= 0)
      assert.equal(row.hint, offset >= 0 ? '预约开始时间已到，待确认面试状态' : null)
      assert.deepEqual(
        [row.interviewStatus, row.scheduledAt, row.completedAt],
        ['scheduled', appointment, null]
      )
      assert.ok(
        page.items.filter((item) => item.interviewStatus !== 'scheduled').every((item) => !item.due)
      )
      const dueItems = await f.get('/dashboard/work-items/due')
      assert.equal(
        dueItems.items.some((item) => item.interviewId === due),
        offset >= 0
      )
    }
    const single = await f.get(endpoint + '?limit=1&offset=4')
    assert.deepEqual(
      [single.total, single.limit, single.offset, single.items.map((row) => row.interviewId)],
      [5, 1, 4, [end]]
    )
    assert.deepEqual(single.byStatus, { scheduled: 3, completed: 1, cancelled: 1 })
    assert.equal((await f.get(endpoint + '?offset=5')).total, 5)
    now = nextDay
    assert.deepEqual(
      (await f.get(endpoint)).items.map((item) => item.interviewId),
      [tomorrow]
    )
    assert.equal((await f.get('/dashboard/summary')).todayInterviews.count, 1)
  })
})

const cursorQuery = (cursor) =>
  '&afterOccurredAt=' + cursor.occurredAt + '&afterEventId=' + cursor.eventId
const traverse = async (read, limit, eventType) => {
  const items = []
  let cursor = null
  do {
    const page = await read(
      '?limit=' +
        limit +
        (eventType ? '&eventType=' + eventType : '') +
        (cursor ? cursorQuery(cursor) : '')
    )
    items.push(...page.items)
    cursor = page.nextCursor
    if (cursor)
      assert.deepEqual(cursor, {
        occurredAt: items.at(-1).occurredAt,
        eventId: items.at(-1).eventId
      })
  } while (cursor)
  return items
}

test('E3-API-05 unified history follows same-millisecond HTTP audit events without exposing profiles', async (t) => {
  t.mock.method(Date, 'now', () => appointment)
  const f = await setup(t)
  const position = await f.position()
  const path = '/positions/' + position.aggregateId
  const a = await f.create(position.aggregateId)
  await a.action('', { note: 'another-private-note', phone: 'another-private-phone' }, 200, 'PATCH')
  await a.advance()
  const i = await a.schedule()
  await a.action('/interviews/' + i.interviewId + '/reschedule', {
    interviewVersion: 1,
    scheduledAt: appointment + 60000
  })
  await a.action('/interviews/' + i.interviewId + '/cancel', {
    interviewVersion: 2,
    reason: 'Fixture cancellation'
  })
  await f.write(path, { expectedVersion: 1, title: 'Renamed fixture title' }, 200, 'PATCH')
  await f.write(path + '/status', { expectedVersion: 2, status: 'closed' })
  await f.write(path + '/archive', { expectedVersion: 3 })
  f.db.exec("UPDATE users SET name='Renamed actor' WHERE id=1")
  await assertReadOnly(f.db, async () => {
    const app = await a.get('/history')
    assert.deepEqual(app.currentPosition, {
      positionId: position.aggregateId,
      title: 'Renamed fixture title'
    })
    assert.equal(app.applicationId, a.id)
    const items = await traverse((query) => a.get('/history' + query), 2)
    const stored = f.db
      .prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY occurred_at,id')
      .all(a.id)
    assert.deepEqual(
      items.map((e) => [
        e.eventId,
        e.applicationVersion,
        e.commandId,
        e.actorUserId,
        e.actorName,
        e.occurredAt
      ]),
      stored.map((e) => [
        e.id,
        e.aggregate_version,
        e.command_id,
        e.actor_user_id,
        e.actor_name_snapshot,
        e.occurred_at
      ])
    )
    assert.ok(
      items.every(
        (e) => e.occurredAt === appointment && e.actorUserId === 1 && e.actorName === 'Test HR'
      )
    )
    assert.deepEqual(
      items.map((e) => e.eventType),
      [
        'candidate_created',
        'candidate_updated',
        'stage_advanced',
        'interview_scheduled',
        'interview_rescheduled',
        'interview_cancelled'
      ]
    )
    assert.deepEqual(items[1].changedFields, ['phone', 'note'])
    assert.equal(items[0].before, null)
    assert.deepEqual(
      [items[4].before.scheduledAt, items[4].after.scheduledAt],
      [appointment, appointment + 60000]
    )
    assert.equal(items[5].reason, 'Fixture cancellation')
    assert.deepEqual(
      (await traverse((query) => a.get('/history' + query), 1, 'interview_cancelled')).map(
        (e) => e.eventId
      ),
      [items[5].eventId]
    )
    const positions = await traverse((query) => f.get(path + '/history' + query), 1)
    assert.deepEqual(
      positions.map((event) => event.eventType),
      ['position_created', 'position_updated', 'position_status_changed', 'position_deleted']
    )
    assert.deepEqual(
      [positions[0].after.title, positions[1].before.title, positions[1].after.title],
      ['Original fixture title', 'Original fixture title', 'Renamed fixture title']
    )
    assert.deepEqual(
      positions.map((e) => e.positionVersion),
      [1, 2, 3, 4]
    )
    assert.doesNotMatch(
      JSON.stringify([items, positions]),
      /private|old_values_json|new_values_json|context_json|password_hash|actor_user_id|fixture-position-description/
    )
  })
})

test('E3-API-05 cross-API waiver, supplement, hire and correction link real history and dashboard', async (t) => {
  let now = appointment
  t.mock.method(Date, 'now', () => now)
  const f = await setup(t)
  const p = await f.position()
  const a = await f.create(p.aggregateId)
  await a.advance()
  const first = await a.schedule()
  await a.complete(first.interviewId)
  await a.feedback(first.interviewId)
  await a.advance()
  const old = []
  for (let j = 0; j < 2; j++) {
    const { interviewId } = await a.schedule()
    await a.complete(interviewId)
    old.push(interviewId)
  }
  assert.equal((await f.get('/dashboard/summary')).work.feedback.count, 2)
  await a.advance({ reason: 'Fixture waiver explanation' })
  const timeline = await a.get('/history')
  const waiver = timeline.items.at(-1)
  assert.equal(waiver.kind, 'missing_feedback')
  assert.deepEqual(
    waiver.missingFeedbackLinks.map((item) => [item.interviewId, item.supplementEventId]),
    old.map((id) => [id, null])
  )
  assert.equal((await f.get('/dashboard/summary')).work.feedback.count, 0)
  await a.action('/offer/send')
  await a.action('/offer/accept')
  now += 1000
  const submitted = await a.action(
    '/interviews/' + old[0] + '/feedback/supplement',
    evaluation,
    201
  )
  const during = await a.get('/historical-missing')
  assert.deepEqual(
    during.map((item) => [item.interviewId, item.historicalMissing, item.canSupplement]),
    [
      [old[0], false, false],
      [old[1], true, true]
    ]
  )
  assert.equal(during[0].supplementedAt, now)
  assert.equal((await f.get('/dashboard/summary')).applicationTotals.hired, 0)
  await a.action('/offer/confirm-hire')
  await a.action('/interviews/' + old[0] + '/feedback/correct', {
    feedbackRevision: 1,
    recommendation: 'undecided',
    correctionReason: 'Fixture correction'
  })
  await assertReadOnly(f.db, async () => {
    const final = (await a.get('/history')).items
    const events = f.db
      .prepare(
        'SELECT id,event_type,aggregate_version FROM business_events WHERE candidate_id=? ORDER BY occurred_at,id'
      )
      .all(a.id)
    assert.deepEqual(
      final.map((e) => [e.eventId, e.eventType, e.applicationVersion]),
      events.map((e) => [e.id, e.event_type, e.aggregate_version])
    )
    const advanced = final.find((event) => event.eventId === waiver.eventId)
    const supplement = final.find((event) => event.eventType === 'feedback_supplemented')
    const hired = final.find((event) => event.eventType === 'candidate_hired')
    const correction = final.find((event) => event.eventType === 'feedback_corrected')
    assert.deepEqual(
      [advanced.reason, advanced.before, advanced.after],
      [waiver.reason, waiver.before, waiver.after]
    )
    assert.equal(advanced.missingFeedbackLinks[0].supplementEventId, supplement.eventId)
    assert.equal(advanced.missingFeedbackLinks[0].supplementActorUserId, 1)
    assert.equal(supplement.waiverEventId, waiver.eventId)
    assert.equal(supplement.feedbackId, submitted.feedbackId)
    assert.deepEqual(correction.priorDecisions, {
      advancementEventId: waiver.eventId,
      closureEventId: hired.eventId
    })
    assert.deepEqual(
      [
        correction.before.recommendation,
        correction.after.recommendation,
        correction.reason,
        correction.actorUserId
      ],
      ['recommend', 'undecided', 'Fixture correction', 1]
    )
    assert.equal(correction.before.submittedAt, correction.after.submittedAt)
    assert.equal(hired.after.outcome, 'hired')
    const missing = await a.get('/historical-missing')
    assert.deepEqual(
      [missing[1].historicalMissing, missing[1].canSupplement, missing[1].blockedReason],
      [true, false, 'APPLICATION_CLOSED']
    )
    const summary = await f.get('/dashboard/summary')
    assert.deepEqual(summary.applicationTotals, {
      total: 1,
      active: 0,
      closed: 1,
      hired: 1,
      unit: 'application_record'
    })
    assert.deepEqual(summary.offerByStatus, { preparing: 0, sent: 0, accepted: 0 })
    assert.equal(summary.work.feedback.count, 0)
  })
})

test('E3-API-05 legacy lookups preserve unknown facts, reject enumeration and keep reads immutable', async (t) => {
  t.mock.method(Date, 'now', () => appointment)
  const f = await setup(t)
  const a = await f.create()
  const summary = await f.get('/dashboard/summary')
  f.legacy({
    legacy_id: a.id,
    mapping_status: 'ambiguous',
    raw_json: JSON.stringify({
      stage: 'rejected',
      name: 'fixture-private-name',
      email: privateEmail,
      note: profileNote
    }),
    facts_json: JSON.stringify({
      stage: null,
      application_status: 'closed',
      outcome: 'company_rejected',
      offer_status: null,
      closed_at: null,
      closed_reason: null,
      token: 'fixture-private-token'
    })
  })
  f.legacy({
    legacy_id: 2,
    mapping_status: 'unique_match',
    mapped_position_id: f.firstPosition,
    raw_json: '{"stage":"offer","phone":"fixture-private-phone"}',
    facts_json: '{"stage":"offer","offer_status":null}'
  })
  f.legacy({
    legacy_id: 2,
    entity_type: 'interviews',
    mapping_status: 'not_applicable',
    raw_json: '{"status":"completed","interviewer":"fixture-private-interviewer"}',
    facts_json: '{"status":"completed","stage_scope":null}'
  })
  f.legacy({
    legacy_id: -2,
    entity_type: 'positions',
    mapping_status: 'not_applicable',
    raw_json: '{"status":"open","title":"fixture-private-title"}',
    facts_json: JSON.stringify({ mapped_position_id: f.firstPosition })
  })
  const lookup = (entityType, id) =>
    '/legacy-records?sourceKey=synthetic-v2&entityType=' + entityType + '&legacyId=' + id
  await assertReadOnly(f.db, async () => {
    const rejected = await f.get(lookup('candidates', a.id))
    assert.deepEqual(rejected.raw, { stage: 'rejected' })
    assert.deepEqual(rejected.facts, {
      stage: null,
      applicationStatus: 'closed',
      outcome: 'company_rejected',
      offerStatus: null,
      closedAt: null,
      closedReason: null
    })
    assert.deepEqual(
      [
        rejected.mappingStatus,
        rejected.mappedPositionId,
        rejected.importedAt,
        rejected.historyStatus,
        rejected.hint
      ],
      ['ambiguous', null, 20, 'history_unknown', '旧版待核实／历史未知']
    )
    const offer = await f.get(lookup('candidates', 2))
    assert.deepEqual(
      [offer.mappingStatus, offer.mappedPositionId, offer.facts.stage, offer.facts.offerStatus],
      ['unique_match', f.firstPosition, 'offer', null]
    )
    const interview = await f.get(lookup('interviews', 2))
    assert.deepEqual(interview.facts, {
      status: 'completed',
      stageScope: null,
      scheduledAt: null,
      completedAt: null,
      cancelledAt: null
    })
    const position = await f.get(lookup('positions', -2))
    assert.deepEqual(position.facts, { mappedPositionId: f.firstPosition })
    assert.doesNotMatch(
      JSON.stringify([rejected, offer, interview, position]),
      /private|raw_json|facts_json/
    )
    assert.deepEqual(await f.get('/dashboard/summary'), summary)
    assert.deepEqual(
      (await a.get('/history')).items.map((event) => event.eventType),
      ['candidate_created']
    )
    failure(
      await f.request(lookup('candidates', 99), { token: f.token }),
      404,
      'LEGACY_RECORD_NOT_FOUND'
    )
    for (const path of [
      '/legacy-records',
      lookup('users', 1),
      lookup('candidates', 1) + '&q=x',
      lookup('candidates', '1e2'),
      lookup('candidates', 1) + '&sourceKey=other',
      '/dashboard/work-items/toString',
      '/dashboard/work-items/offer?status=sent',
      '/dashboard/offer-work-items/declined',
      '/dashboard/work-items/feedback?limit=101',
      '/dashboard/work-items/feedback?limit=1&limit=2',
      '/dashboard/today-interviews?offset=100001',
      '/dashboard/summary?extra=1',
      '/positions/1/history?eventType=candidate_created',
      '/applications/' + a.id + '/history?eventType=position_created',
      '/applications/' + a.id + '/history?afterOccurredAt=0',
      '/applications/' + a.id + '/history?afterEventId=1',
      '/applications/' + a.id + '/history?afterOccurredAt=0&afterEventId=0',
      '/applications/' + a.id + '/history?limit=0'
    ])
      failure(await f.request(path, { token: f.token }), 400)
    failure(
      await f.request('/applications/99999/history', { token: f.token }),
      404,
      'AGGREGATE_NOT_FOUND'
    )
    failure(
      await f.request(lookup('candidates', a.id), { token: f.token, method: 'POST', body: {} }),
      404,
      'NOT_FOUND'
    )
  })
})
