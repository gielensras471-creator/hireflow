import { openTestDatabase } from './test-db.js'
import { createV3Schema } from '../../server/db/schema-v3.js'

export const insert = (db, table, values) => {
  const keys = Object.keys(values)
  return Number(
    db
      .prepare(
        'INSERT INTO ' +
          table +
          ' (' +
          keys.join(',') +
          ') VALUES (' +
          keys.map(() => '?').join(',') +
          ')'
      )
      .run(...Object.values(values)).lastInsertRowid
  )
}

export const fixture = (t) => {
  const db = openTestDatabase()
  t.after(() => db.close())
  createV3Schema(db)
  insert(db, 'users', {
    id: 1,
    username: 'hr-test',
    password_hash: 'fixture-not-a-real-hash',
    name: 'Test HR',
    role: 'test',
    department: 'Test',
    email: 'hr@example.invalid',
    phone: 'test'
  })
  let command = 0
  const position = (values = {}) =>
    insert(db, 'positions', {
      title: 'Same title',
      department: 'Test',
      location: 'Test',
      status: 'open',
      publish_date: '2026-11-03',
      description: 'Fixture',
      ...values
    })
  const firstPosition = position()
  const candidate = (values = {}) =>
    insert(db, 'candidates', {
      position_id: firstPosition,
      name: 'Same person',
      education: '',
      school: '',
      phone: '',
      email: '',
      owner: 'Test',
      applied_date: '2026-11-03',
      created_at: 1,
      stage: 'first_interview',
      application_status: 'active',
      ...values
    })
  const interview = (candidateId, values = {}) =>
    insert(db, 'interviews', {
      candidate_id: candidateId,
      stage_scope: 'first_interview',
      scheduled_at: 10,
      interviewer_name: 'Test reviewer',
      status: 'completed',
      created_at: 1,
      completed_at: 11,
      ...values
    })
  const feedback = (interviewId, values = {}) =>
    insert(db, 'feedback', {
      interview_id: interviewId,
      reviewer_name: 'Reviewer',
      recorded_by_user_id: 1,
      recommendation: 'recommend',
      reason: 'Fixture evidence',
      submitted_at: 12,
      ...values
    })
  const receipt = (values = {}) => {
    command++
    const commandId = 'command-' + command
    insert(db, 'command_receipts', {
      command_id: commandId,
      actor_user_id: 1,
      idempotency_key: 'key-' + command,
      request_sha256: 'a'.repeat(64),
      result_json: '{}',
      committed_at: 20,
      ...values
    })
    return commandId
  }
  const event = (values = {}) =>
    insert(db, 'business_events', {
      aggregate_type: 'candidate',
      candidate_id: null,
      command_id: receipt(),
      aggregate_version: command,
      event_type: 'candidate_created',
      actor_user_id: 1,
      actor_name_snapshot: 'Test HR',
      occurred_at: 20,
      old_values_json: '{}',
      new_values_json: '{}',
      context_json: '{}',
      ...values
    })
  const legacy = (values = {}) =>
    insert(db, 'legacy_records', {
      source_key: 'synthetic-v2',
      entity_type: 'candidates',
      legacy_id: 1,
      raw_json: '{"stage":"rejected"}',
      facts_json:
        '{"application_status":"closed","outcome":"company_rejected","stage":null,"closed_at":null,"closed_reason":null}',
      mapping_status: 'no_match',
      imported_at: 20,
      ...values
    })
  return { db, position, firstPosition, candidate, interview, feedback, receipt, event, legacy }
}
