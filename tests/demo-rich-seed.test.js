import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDemoDatabase } from '../server/demo-v3.js'
import { startDemoServer } from '../server/index-demo-v3.js'
import { createDashboardService } from '../server/services/dashboard-service.js'
import { shanghaiWeek, weekGroups } from '../src/api/v4-interview-week.ts'

const password = 'fictional-demo-test'
const distribution = [18, 25, 32, 39, 26, 33, 27]
const tables = ['positions', 'candidates', 'interviews', 'feedback', 'legacy_records']
const snapshot = (db) =>
  tables.map((table) => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())
const total = (db, table) => db.prepare('SELECT count(*) n FROM ' + table).get().n

test('rich Demo seed stays current over a year and across reset and calendar boundaries', (t) => {
  const day = 86_400_000
  const offset = 8 * 3_600_000
  const reference = Date.parse('2026-11-26T04:00:00+08:00')
  const times = [
    Date.now(),
    ...[0, 1, 7, 30, 180, 365].map((days) => reference + days * day),
    ...[
      '2026-11-30T04:00:00+08:00',
      '2026-12-01T04:00:00+08:00',
      '2026-12-31T04:00:00+08:00',
      '2027-01-01T04:00:00+08:00',
      '2028-02-29T04:00:00+08:00',
      '2028-03-01T04:00:00+08:00'
    ].map((value) => Date.parse(value))
  ]
  for (const now of times) {
    const { db } = createDemoDatabase(password, { seed: 'rich', now })
    try {
      const service = createDashboardService({ db, clock: () => now, resolveActor: () => 1 })
      assert.deepEqual(
        service.historyMetrics({}).applications.months.map((month) => month.count),
        distribution
      )
      assert.deepEqual(
        tables.map((table) => total(db, table)),
        [24, 200, 175, 91, 10]
      )
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      const rows = db
        .prepare(
          `
        SELECT id, status, scheduled_at AS scheduledAt, created_at AS createdAt,
          completed_at AS completedAt, cancelled_at AS cancelledAt, cancel_reason AS reason
        FROM interviews ORDER BY scheduled_at, id
      `
        )
        .all()
      const matches = (status, predicate) =>
        rows.filter((row) => row.status === status && predicate(row))
      assert.ok(rows.every((row) => row.createdAt <= now))
      assert.ok(
        matches('completed', (row) => row.completedAt >= row.scheduledAt && row.completedAt <= now)
          .length > 0
      )
      assert.equal(
        matches('completed', (row) => row.completedAt < row.scheduledAt || row.completedAt > now)
          .length,
        0
      )
      assert.equal(matches('cancelled', (row) => !row.reason || row.cancelledAt > now).length, 0)
      const due = matches('scheduled', (row) => row.scheduledAt <= now).length
      const future = matches('scheduled', (row) => row.scheduledAt > now).length
      assert.ok(due >= 2 && future >= 8)
      const weekCards = weekGroups(rows, shanghaiWeek(now)).flat().length
      assert.ok(weekCards >= 3)
      const today = service.todayInterviews({}).total
      assert.ok(today > 0)
      const isoMonth = new Date(now + offset).toISOString().slice(0, 7)
      const month = rows.filter((row) =>
        new Date(row.scheduledAt + offset).toISOString().startsWith(isoMonth)
      ).length
      assert.ok(month > 0)
      assert.equal(
        db.prepare('SELECT count(*) n FROM business_events WHERE occurred_at > ?').get(now).n,
        0
      )
      assert.equal(
        db
          .prepare(
            `
        SELECT count(*) n FROM command_receipts r LEFT JOIN business_events e USING(command_id)
        WHERE e.id IS NULL OR r.committed_at != e.occurred_at
      `
          )
          .get().n,
        0
      )
      t.diagnostic(
        `${new Date(now + offset).toISOString().slice(0, 16)} UTC+8: today=${today} weekCards=${weekCards} month=${month} due=${due} future=${future}`
      )
    } finally {
      db.close()
    }
  }
})

test('rich calendar exposes distinct ordinary states and planned groups on a typical workday', () => {
  const now = Date.parse('2026-11-26T08:50:00+08:00')
  const { db } = createDemoDatabase(password, { seed: 'rich', now })
  try {
    const rows = db
      .prepare(
        'SELECT status, scheduled_at AS scheduledAt FROM interviews ORDER BY scheduled_at, id'
      )
      .all()
    const cards = weekGroups(rows, shanghaiWeek(now)).flat()
    const singles = (status, predicate = () => true) =>
      cards.filter(
        ({ rows }) => rows.length === 1 && rows[0].status === status && predicate(rows[0])
      ).length
    assert.equal(
      singles('scheduled', ({ scheduledAt }) => scheduledAt > now),
      9
    )
    assert.equal(
      singles('scheduled', ({ scheduledAt }) => scheduledAt <= now),
      2
    )
    assert.equal(singles('completed'), 6)
    assert.equal(singles('cancelled'), 3)
    assert.deepEqual(
      cards
        .filter((card) => card.rows.length > 1)
        .map((card) => card.rows.length)
        .sort(),
      [2, 2, 3, 4]
    )
  } finally {
    db.close()
  }
})

test('rich seed produces deterministic legal business rows with real versioned events', () => {
  for (const [at, start] of [
    ['2024-02-29T23:59:59+08:00', '2023-08-01'],
    ['2027-01-01T00:00:00+08:00', '2026-07-01']
  ]) {
    const now = Date.parse(at)
    const { db } = createDemoDatabase(password, { seed: 'rich', now })
    const other = createDemoDatabase(password, { seed: 'rich', now })
    try {
      assert.deepEqual(snapshot(db), snapshot(other.db))
      assert.notEqual(
        db.prepare('SELECT password_hash FROM users').get().password_hash,
        other.db.prepare('SELECT password_hash FROM users').get().password_hash
      )
      const eventSnapshot = (connection) =>
        connection
          .prepare(
            'SELECT id, candidate_id, position_id, event_type, occurred_at, old_values_json, new_values_json, context_json FROM business_events ORDER BY id'
          )
          .all()
      assert.deepEqual(eventSnapshot(db), eventSnapshot(other.db))
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      assert.deepEqual(
        tables.map((table) => total(db, table)),
        [24, 200, 175, 91, 10]
      )
      assert.deepEqual(
        db
          .prepare(
            "SELECT stage,count(*) AS n FROM candidates WHERE application_status='active' GROUP BY stage ORDER BY stage"
          )
          .all()
          .map((row) => row.n),
        [22, 9, 32, 17]
      )
      assert.equal(
        db.prepare("SELECT count(*) n FROM candidates WHERE outcome='hired'").get().n,
        17
      )
      assert.equal(db.prepare("SELECT count(*) n FROM positions WHERE status='open'").get().n, 16)
      for (const [sql, params] of [
        ['SELECT count(*) n FROM business_events WHERE occurred_at>?', [now]],
        [
          'SELECT count(*) n FROM candidates c JOIN positions p ON c.position_id=p.id WHERE c.applied_date < p.publish_date',
          []
        ],
        [
          "SELECT count(*) n FROM interviews WHERE completed_at>? OR (status='completed' AND completed_at<scheduled_at)",
          [now]
        ],
        [
          "SELECT count(*) n FROM (SELECT candidate_id FROM interviews WHERE status='scheduled' GROUP BY candidate_id HAVING count(*)>1)",
          []
        ],
        [
          'SELECT count(*) n FROM (SELECT interview_id FROM feedback GROUP BY interview_id HAVING count(*)>1)',
          []
        ],
        [
          'SELECT count(*) n FROM business_events e JOIN business_events p ON p.candidate_id=e.candidate_id AND p.aggregate_version=e.aggregate_version-1 WHERE p.occurred_at>e.occurred_at',
          []
        ],
        [
          'SELECT count(*) n FROM command_receipts r LEFT JOIN business_events e USING(command_id) WHERE e.id IS NULL OR r.committed_at != e.occurred_at',
          []
        ]
      ])
        assert.equal(db.prepare(sql).get(...params).n, 0, sql)
      for (const event of [
        'interview_rescheduled',
        'feedback_corrected',
        'feedback_supplemented',
        'offer_sent',
        'offer_accepted',
        'offer_declined'
      ])
        assert.ok(
          db.prepare('SELECT count(*) n FROM business_events WHERE event_type=?').get(event).n > 0,
          event
        )
      assert.equal(
        db.prepare("SELECT count(*) n FROM business_events WHERE event_type='offer_sent'").get().n,
        33
      )
      const cross = db
        .prepare(
          "SELECT count(*) n FROM business_events s JOIN business_events r USING(candidate_id) WHERE s.event_type='offer_sent' AND r.event_type IN ('offer_accepted','offer_declined') AND strftime('%Y-%m',s.occurred_at/1000,'unixepoch','+8 hours')!=strftime('%Y-%m',r.occurred_at/1000,'unixepoch','+8 hours')"
        )
        .get()
      assert.ok(cross.n > 0)
      const service = createDashboardService({ db, clock: () => now, resolveActor: () => 1 })
      const metrics = service.historyMetrics({})
      assert.equal(metrics.applications.startDate, start)
      assert.deepEqual(
        metrics.applications.months.map((row) => row.count),
        distribution
      )
      assert.ok(metrics.offer.sent > 0 && metrics.offer.responded > 0)
      assert.equal(metrics.applications.coverage, 'partial')
      assert.ok(metrics.applications.reasons.includes('legacy_application_history_not_included'))
      assert.ok(Object.values(service.summary({}).work).every(({ count }) => count > 0))
      assert.ok(service.todayInterviews({}).total > 0)
      assert.equal(
        db
          .prepare(
            "SELECT json_extract(facts_json,'$.stage') AS stage FROM legacy_records WHERE legacy_id=100"
          )
          .get().stage,
        null
      )
    } finally {
      other.db.close()
      db.close()
    }
  }
})

test('rich Demo HTTP reads real data and restart replaces both data and session', async (t) => {
  const staticDir = await mkdtemp(join(tmpdir(), 'hireflow-rich-http-'))
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Demo fixture</title>')
  await writeFile(
    join(staticDir, 'demo-build.json'),
    JSON.stringify({ kind: 'hireflow-isolated-demo', apiBase: '/api/v3' })
  )
  t.after(() => rm(staticDir, { recursive: true, force: true }))
  const open = (reference) => {
    const clock = Date.now
    let starting = true
    Date.now = () => (starting && reference !== undefined ? reference : clock())
    try {
      // The server finishes synchronous initialization before its first await (listen).
      return startDemoServer({ password, port: 0, staticDir, seed: 'rich' })
    } finally {
      starting = false
      Date.now = clock
    }
  }
  let instance = await open()
  const request = async (path, token, body) => {
    const res = await fetch(
      'http://127.0.0.1:' + instance.server.address().port + '/api/v3' + path,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(body
            ? { 'Content-Type': 'application/json', 'Idempotency-Key': 'rich-test-write' }
            : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }
    )
    return { status: res.status, data: await res.json() }
  }
  try {
    const login = () => request('/auth/login', null, { username: 'demo_admin', password })
    const token = (await login()).data.token
    assert.deepEqual(
      (await request('/dashboard/history-metrics', token)).data.applications.months.map(
        (row) => row.count
      ),
      distribution
    )
    assert.equal((await request('/positions?limit=10', token)).data.total, 24)
    assert.equal((await request('/applications?limit=20', token)).data.total, 200)
    assert.equal((await request('/interviews?limit=20', token)).data.total, 175)
    assert.equal((await request('/legacy-records/list?limit=20', token)).data.total, 10)
    assert.equal(
      (
        await request('/positions', token, {
          title: 'Disposable fixture',
          department: 'Demo',
          location: 'Demo',
          publishDate: '2026-01-01',
          description: 'Synthetic reset verification'
        })
      ).status,
      201
    )
    assert.equal((await request('/positions?limit=1', token)).data.total, 25)
    await instance.close()
    const day = 86_400_000
    const offset = 8 * 3_600_000
    const nextReset = (Math.floor((Date.now() + offset) / day) + 1) * day - offset + 4 * 3_600_000
    let staleToken = token
    for (const reference of [nextReset, nextReset + 7 * day]) {
      instance = await open(reference)
      try {
        assert.equal((await request('/ready')).status, 200)
        assert.equal((await request('/dashboard/history-metrics', staleToken)).status, 401)
        staleToken = (await login()).data.token
        assert.equal((await request('/interviews?limit=1', staleToken)).data.total, 175)
        assert.equal((await request('/positions?limit=1', staleToken)).data.total, 24)
        assert.equal(
          instance.db.prepare('SELECT max(publish_date) day FROM positions').get().day,
          new Date(reference + offset).toISOString().slice(0, 10)
        )
      } finally {
        await instance.close()
      }
    }
  } finally {
    await instance.close()
  }
})
