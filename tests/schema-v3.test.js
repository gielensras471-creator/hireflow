import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSchema } from '../server/db/schema.js'
import { createV3Schema } from '../server/db/schema-v3.js'
import { openTestDatabase, createTestWorkspace, removeTestWorkspace } from './helpers/test-db.js'
import { fixture, insert } from './helpers/v3-db.js'

const rejected = (fn) =>
  assert.throws(fn, /constraint|immutable|sealed|requires explained advancement/i)
const rows = (db, table) => db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n

test('V3 initialization is explicit, empty-only, memory-only and requires FK enforcement', (t) => {
  const empty = openTestDatabase()
  t.after(() => empty.close())
  assert.equal(rows(empty, 'sqlite_schema'), 0)
  createV3Schema(empty)
  assert.equal(rows(empty, 'users'), 0)
  assert.equal(rows(empty, 'schema_migrations'), 0)
  assert.equal(
    empty.prepare("SELECT COUNT(*) n FROM pragma_table_list WHERE schema='main' AND strict=1").get()
      .n,
    10
  )
  assert.throws(() => createV3Schema(empty), /empty/)
  const v2 = openTestDatabase()
  t.after(() => v2.close())
  createSchema(v2)
  assert.throws(() => createV3Schema(v2), /empty/)
  assert.ok(
    v2
      .prepare('PRAGMA table_info(candidates)')
      .all()
      .some((c) => c.name === 'position')
  )
  const fkOff = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
  t.after(() => fkOff.close())
  assert.throws(() => createV3Schema(fkOff), /Foreign keys/)
  assert.equal(rows(fkOff, 'sqlite_schema'), 0)
  const root = createTestWorkspace()
  let file
  t.after(() => {
    if (file?.isOpen) file.close()
    removeTestWorkspace(root)
  })
  file = openTestDatabase({ root, databasePath: path.join(root, 'empty.db') })
  assert.throws(() => createV3Schema(file), /in-memory/)
  assert.equal(rows(file, 'sqlite_schema'), 0)
  const attached = openTestDatabase()
  t.after(() => attached.close())
  attached.exec("ATTACH DATABASE ':memory:' AS extra; CREATE TABLE extra.original (id INTEGER)")
  assert.throws(() => createV3Schema(attached), /attached/)
  assert.equal(rows(attached, 'main.sqlite_schema'), 0)
  assert.equal(rows(attached, 'extra.sqlite_schema'), 1)
  assert.equal(empty.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 1)
  empty.exec('BEGIN')
  assert.throws(() => createV3Schema(empty), /own transaction/)
  empty.exec('ROLLBACK')
})

test('AC-01/02/03/18/19 foundation: stable IDs, same-name jobs and separate application records', (t) => {
  const f = fixture(t),
    { db } = f
  const other = f.position()
  const a = f.candidate(),
    b = f.candidate({ position_id: other })
  assert.notEqual(a, b)
  rejected(() => f.candidate({ position_id: 9999 }))
  rejected(() => f.candidate({ position_id: null }))
  db.prepare('UPDATE positions SET title=? WHERE id=?').run('Renamed', f.firstPosition)
  assert.equal(
    db.prepare('SELECT position_id FROM candidates WHERE id=?').get(a).position_id,
    f.firstPosition
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM candidates WHERE position_id=?').get(other).n, 1)
  rejected(() => db.prepare('UPDATE candidates SET position_id=? WHERE id=?').run(other, a))
  rejected(() => db.prepare('DELETE FROM positions WHERE id=?').run(f.firstPosition))
  db.prepare("UPDATE positions SET status='closed' WHERE id=?").run(f.firstPosition)
  assert.equal(
    db.prepare('SELECT application_status FROM candidates WHERE id=?').get(a).application_status,
    'active'
  )
  assert.equal(
    db
      .prepare('PRAGMA table_info(positions)')
      .all()
      .some((c) => c.name === 'candidate_count'),
    false
  )
  rejected(() => f.position({ title: '   ' }))
  rejected(() => f.position({ status: 'unknown' }))
})

test('AC-33 storage matrix: exhaustive valid/invalid and NULL combinations on INSERT and UPDATE', (t) => {
  const f = fixture(t),
    { db } = f
  const existing = f.candidate()
  const ordinary = ['screening', 'first_interview', 'second_interview']
  let legalCount = 0,
    attempts = 0
  for (const status of ['active', 'closed', 'invalid', null])
    for (const stage of [...ordinary, 'offer', 'rejected', null])
      for (const offer of [null, 'preparing', 'sent', 'accepted', 'declined'])
        for (const outcome of [
          null,
          'hired',
          'company_rejected',
          'candidate_withdrew',
          'offer_declined'
        ]) {
          const ordinaryStage = ordinary.includes(stage)
          const terminal = outcome === 'company_rejected' || outcome === 'candidate_withdrew'
          const legal =
            status === 'active'
              ? outcome === null &&
                ((ordinaryStage && offer === null) ||
                  (stage === 'offer' && ['preparing', 'sent', 'accepted'].includes(offer)))
              : status === 'closed' &&
                ((ordinaryStage && offer === null && terminal) ||
                  (stage === 'offer' &&
                    ((offer === 'accepted' && outcome === 'hired') ||
                      (offer === 'declined' && outcome === 'offer_declined') ||
                      (['preparing', 'sent', 'accepted'].includes(offer) && terminal))))
          const values = {
            application_status: status,
            stage,
            offer_status: offer,
            outcome,
            closed_at: status === 'closed' ? 2 : null,
            closed_reason: status === 'closed' ? 'Fixture reason' : null
          }
          const update = () =>
            db
              .prepare(
                'UPDATE candidates SET application_status=?,stage=?,offer_status=?,outcome=?,closed_at=?,closed_reason=? WHERE id=?'
              )
              .run(status, stage, offer, outcome, values.closed_at, values.closed_reason, existing)
          db.exec('SAVEPOINT matrix_case')
          if (legal) {
            f.candidate(values)
            update()
            legalCount++
          } else {
            rejected(() => f.candidate(values))
            rejected(update)
          }
          db.exec('ROLLBACK TO matrix_case; RELEASE matrix_case')
          attempts++
        }
  assert.equal(legalCount, 20)
  assert.equal(attempts, 600)
  assert.equal(rows(db, 'candidates'), 1)
})

test('lifecycle metadata rejects blank reasons, missing timestamps, unknown values and invalid versions', (t) => {
  const f = fixture(t)
  for (const reason of [null, '', '   '])
    rejected(() =>
      f.candidate({
        application_status: 'closed',
        outcome: 'company_rejected',
        closed_at: 2,
        closed_reason: reason
      })
    )
  rejected(() =>
    f.candidate({
      application_status: 'closed',
      outcome: 'company_rejected',
      closed_reason: 'Reason'
    })
  )
  rejected(() => f.candidate({ closed_at: 2 }))
  rejected(() => f.candidate({ closed_reason: 'Not closed' }))
  rejected(() =>
    f.candidate({
      application_status: 'closed',
      outcome: 'company_rejected',
      closed_at: 0,
      closed_reason: 'Reason'
    })
  )
  rejected(() => f.candidate({ offer_status: 'unknown' }))
  rejected(() => f.candidate({ outcome: 'unknown' }))
  rejected(() => f.candidate({ version: 0 }))
  assert.throws(() => f.candidate({ created_at: 'not-an-integer' }), /INTEGER/)
})

test('interview FK, scope, activity timestamps and one-scheduled index preserve sequential interviews', (t) => {
  const f = fixture(t),
    { db } = f,
    c = f.candidate()
  const scheduled = { status: 'scheduled', completed_at: null }
  const first = f.interview(c, scheduled)
  rejected(() => f.interview(c, scheduled))
  rejected(() => f.interview(c, { ...scheduled, stage_scope: 'second_interview' }))
  db.prepare(
    "UPDATE interviews SET status='cancelled',cancelled_at=12,cancel_reason='Test cancellation' WHERE id=?"
  ).run(first)
  const second = f.interview(c, scheduled)
  db.prepare("UPDATE interviews SET status='completed',completed_at=13 WHERE id=?").run(second)
  f.interview(c, scheduled)
  assert.equal(rows(db, 'interviews'), 3)
  rejected(() => f.interview(999))
  rejected(() => f.interview(c, { stage_scope: 'HR' }))
  rejected(() => f.interview(c, { completed_at: null }))
  rejected(() => f.interview(c, { status: 'scheduled' }))
  rejected(() =>
    f.interview(c, {
      status: 'cancelled',
      completed_at: null,
      cancelled_at: 12,
      cancel_reason: ' '
    })
  )
  rejected(() =>
    db.prepare("UPDATE interviews SET stage_scope='second_interview' WHERE id=?").run(first)
  )
  rejected(() => db.prepare('DELETE FROM candidates WHERE id=?').run(c))
  assert.equal(
    db.prepare('SELECT stage FROM candidates WHERE id=?').get(c).stage,
    'first_interview'
  )
})

test('AC-23/24 foundation: unique current feedback, required evidence and original author/time preservation', (t) => {
  const f = fixture(t),
    { db } = f,
    c = f.candidate(),
    i = f.interview(c),
    feedback = f.feedback(i)
  rejected(() => f.feedback(i))
  rejected(() => f.feedback(999))
  const other = f.interview(c)
  for (const values of [
    { reviewer_name: ' ' },
    { reason: '' },
    { recommendation: 'pass' },
    { recorded_by_user_id: 999 },
    { submitted_at: null }
  ])
    rejected(() => f.feedback(other, values))
  rejected(() => db.prepare('UPDATE feedback SET submitted_at=100 WHERE id=?').run(feedback))
  rejected(() => db.prepare('UPDATE feedback SET recorded_by_user_id=999 WHERE id=?').run(feedback))
  rejected(() => db.prepare('UPDATE feedback SET interview_id=? WHERE id=?').run(other, feedback))
  rejected(() => db.prepare('DELETE FROM interviews WHERE id=?').run(i))
  rejected(() => db.prepare('DELETE FROM users WHERE id=1').run())
})

test('events support position and candidate aggregates with independent version uniqueness and immutable snapshots', (t) => {
  const f = fixture(t),
    { db } = f,
    c = f.candidate()
  const pEvent = f.event({
    aggregate_type: 'position',
    position_id: f.firstPosition,
    event_type: 'position_updated',
    aggregate_version: 1,
    old_values_json: '{"title":"Old"}',
    new_values_json: '{"title":"New"}'
  })
  const event = f.event({ candidate_id: c, aggregate_version: 1 })
  rejected(() => f.event({ candidate_id: c, aggregate_version: 1 }))
  rejected(() =>
    f.event({
      aggregate_type: 'position',
      position_id: f.firstPosition,
      event_type: 'position_updated',
      aggregate_version: 1
    })
  )
  for (const value of [
    {},
    { candidate_id: c, position_id: f.firstPosition },
    { aggregate_type: 'position', position_id: f.firstPosition, event_type: 'stage_advanced' },
    { candidate_id: c, event_type: 'position_updated' },
    { candidate_id: 999 },
    { candidate_id: c, actor_user_id: 999 },
    { candidate_id: c, old_values_json: 'not-json' }
  ])
    rejected(() => f.event(value))
  rejected(() => db.prepare("UPDATE business_events SET reason='Changed' WHERE id=?").run(event))
  rejected(() => db.prepare('DELETE FROM business_events WHERE id=?').run(event))
  rejected(() => db.exec('INSERT OR REPLACE INTO business_events SELECT * FROM business_events'))
  rejected(() => db.prepare('DELETE FROM candidates WHERE id=?').run(c))
  rejected(() => db.prepare('DELETE FROM positions WHERE id=?').run(f.firstPosition))
  assert.equal(
    db.prepare('SELECT old_values_json FROM business_events WHERE id=?').get(pEvent)
      .old_values_json,
    '{"title":"Old"}'
  )
})

test('event interview/feedback ownership cannot cross applications or interviews', (t) => {
  const f = fixture(t),
    c = f.candidate(),
    other = f.candidate()
  const i = f.interview(c),
    j = f.interview(other),
    feedback = f.feedback(i)
  f.event({
    candidate_id: c,
    interview_id: i,
    feedback_id: feedback,
    event_type: 'feedback_submitted'
  })
  rejected(() => f.event({ candidate_id: other, interview_id: i }))
  rejected(() =>
    f.event({
      candidate_id: other,
      interview_id: j,
      feedback_id: feedback,
      event_type: 'feedback_corrected',
      reason: 'Fix'
    })
  )
  rejected(() =>
    f.event({ candidate_id: c, feedback_id: feedback, event_type: 'feedback_submitted' })
  )
  rejected(() => f.event({ candidate_id: c, event_type: 'feedback_corrected', reason: 'Fix' }))
  rejected(() =>
    f.event({
      candidate_id: c,
      interview_id: i,
      feedback_id: feedback,
      event_type: 'feedback_corrected',
      reason: ' '
    })
  )
})

test('AC-34 storage foundation retains complete correction snapshots and original submission facts', (t) => {
  const f = fixture(t),
    { db } = f,
    c = f.candidate(),
    i = f.interview(c),
    id = f.feedback(i)
  const old = db.prepare('SELECT * FROM feedback WHERE id=?').get(id)
  db.transaction(() => {
    db.prepare(
      "UPDATE feedback SET recommendation='undecided',reason='Corrected evidence',revision=2 WHERE id=?"
    ).run(id)
    const updated = db.prepare('SELECT * FROM feedback WHERE id=?').get(id)
    f.event({
      candidate_id: c,
      interview_id: i,
      feedback_id: id,
      event_type: 'feedback_corrected',
      reason: 'Corrected mis-entry',
      old_values_json: JSON.stringify(old),
      new_values_json: JSON.stringify(updated)
    })
  })()
  const e = db.prepare("SELECT * FROM business_events WHERE event_type='feedback_corrected'").get()
  assert.deepEqual(JSON.parse(e.old_values_json), { ...old })
  assert.equal(JSON.parse(e.new_values_json).reason, 'Corrected evidence')
  assert.equal(db.prepare('SELECT submitted_at FROM feedback WHERE id=?').get(id).submitted_at, 12)
  assert.equal(rows(db, 'feedback'), 1)
})

test('missing feedback snapshots require same-application advancement event and fixed interview stage', (t) => {
  const f = fixture(t),
    { db } = f,
    c = f.candidate(),
    other = f.candidate()
  const i = f.interview(c),
    j = f.interview(other)
  const e = f.event({
    candidate_id: c,
    event_type: 'stage_advanced',
    reason: 'Missing evaluation explained'
  })
  const base = { event_id: e, interview_id: i, candidate_id: c, stage_scope: 'first_interview' }
  insert(db, 'advancement_missing_feedback', base)
  rejected(() => insert(db, 'advancement_missing_feedback', base))
  rejected(() => insert(db, 'advancement_missing_feedback', { ...base, interview_id: j }))
  rejected(() =>
    insert(db, 'advancement_missing_feedback', { ...base, stage_scope: 'second_interview' })
  )
  const notAdvance = f.event({ candidate_id: c })
  rejected(() => insert(db, 'advancement_missing_feedback', { ...base, event_id: notAdvance }))
  const otherAdvance = f.event({
    candidate_id: other,
    event_type: 'stage_advanced',
    reason: 'Reason'
  })
  rejected(() => insert(db, 'advancement_missing_feedback', { ...base, event_id: otherAdvance }))
  rejected(() => db.exec('UPDATE advancement_missing_feedback SET stage_scope=stage_scope'))
  rejected(() => db.exec('DELETE FROM advancement_missing_feedback'))
  rejected(() =>
    db.exec(
      'INSERT OR REPLACE INTO advancement_missing_feedback SELECT * FROM advancement_missing_feedback'
    )
  )
})

test('receipts enforce actor, request identity uniqueness, JSON validity and immutable committed results', (t) => {
  const f = fixture(t),
    { db } = f
  f.receipt({ idempotency_key: 'same' })
  rejected(() => f.receipt({ idempotency_key: 'same' }))
  rejected(() => f.receipt({ actor_user_id: 999 }))
  rejected(() => f.receipt({ result_json: 'invalid' }))
  rejected(() => f.receipt({ request_sha256: 'short' }))
  rejected(() => db.exec("UPDATE command_receipts SET result_json='{}'"))
  rejected(() => db.exec('DELETE FROM command_receipts'))
  rejected(() => db.exec('INSERT OR REPLACE INTO command_receipts SELECT * FROM command_receipts'))
})

test('AC-16/31 foundation: legacy unknowns, stable mappings, read-only archive and sealed import', (t) => {
  const f = fixture(t),
    { db } = f
  f.legacy()
  f.legacy({
    legacy_id: 2,
    raw_json: '{"stage":"offer"}',
    facts_json: '{"stage":"offer","offer_status":null}',
    mapping_status: 'unique_match',
    mapped_position_id: f.firstPosition
  })
  f.legacy({ legacy_id: 3, mapping_status: 'ambiguous' })
  rejected(() => f.legacy())
  rejected(() => f.legacy({ legacy_id: 4, mapping_status: 'unique_match' }))
  rejected(() =>
    f.legacy({ legacy_id: 4, mapping_status: 'no_match', mapped_position_id: f.firstPosition })
  )
  rejected(() =>
    f.legacy({ legacy_id: 4, mapping_status: 'unique_match', mapped_position_id: 999 })
  )
  rejected(() => f.legacy({ legacy_id: 4, raw_json: 'broken' }))
  rejected(() => db.exec("UPDATE legacy_records SET facts_json='{}'"))
  rejected(() => db.exec('DELETE FROM legacy_records'))
  rejected(() => db.exec('INSERT OR REPLACE INTO legacy_records SELECT * FROM legacy_records'))
  const rejectedFacts = JSON.parse(
    db.prepare('SELECT facts_json FROM legacy_records WHERE legacy_id=1').get().facts_json
  )
  assert.equal(rejectedFacts.stage, null)
  assert.equal(rejectedFacts.closed_at, null)
  assert.equal(rows(db, 'candidates'), 0)
  assert.equal(rows(db, 'business_events'), 0)
  insert(db, 'schema_migrations', {
    version: '003_v3_import',
    script_sha256: 'b'.repeat(64),
    source_fingerprint: 'fixture',
    applied_at: 20,
    executor: 'test',
    report_json: '{}'
  })
  rejected(() => f.legacy({ legacy_id: 4 }))
  rejected(() => db.exec('DELETE FROM schema_migrations'))
  rejected(() =>
    db.exec('INSERT OR REPLACE INTO schema_migrations SELECT * FROM schema_migrations')
  )
  rejected(() => db.exec("UPDATE schema_migrations SET version='unsealed'"))
})

test('constraint errors roll back new data, receipt and event together in an isolated transaction', (t) => {
  const f = fixture(t),
    { db } = f
  assert.throws(
    db.transaction(() => {
      const c = f.candidate()
      f.event({ candidate_id: c })
      f.event({ candidate_id: c, actor_user_id: 999 })
    }),
    /FOREIGN KEY/
  )
  for (const table of ['candidates', 'business_events', 'command_receipts'])
    assert.equal(rows(db, table), 0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
})
