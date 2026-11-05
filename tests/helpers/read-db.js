import assert from 'node:assert/strict'
import { createRecruitingService } from '../../server/services/recruiting-service.js'
import { createInterviewService } from '../../server/services/interview-service.js'
import { createOfferService } from '../../server/services/offer-service.js'
import { decisionFixture } from './decision-db.js'

export const readFixture = (t) => {
  const f = decisionFixture(t)
  const dependencies = { db: f.db, resolveActor: f.resolveActor }
  const recruiting = createRecruitingService(dependencies)
  const interviews = createInterviewService(dependencies)
  const offers = createOfferService(dependencies)
  const run = (service, command, payload = {}, candidateId = f.candidateId) =>
    service.execute(
      f.context,
      f.request(command, payload, {
        aggregateId: candidateId,
        expectedVersion: f.db.prepare('SELECT version FROM candidates WHERE id=?').get(candidateId)
          .version
      })
    ).result
  let sequence = 0
  const recruit = (command, payload, aggregateId, expectedVersion) =>
    recruiting.execute(f.context, {
      command,
      payload,
      idempotencyKey: 'recruit-' + ++sequence,
      ...(aggregateId === undefined ? {} : { aggregateId, expectedVersion })
    }).result
  return { ...f, dependencies, interviews, offers, run, recruit }
}

export const closed = (outcome) => ({
  application_status: 'closed',
  outcome,
  closed_reason: 'Fixture closure',
  closed_at: 100
})

export const evaluation = (interviewId) => ({
  interview_id: interviewId,
  reviewer_name: 'Independent reviewer',
  recommendation: 'not_recommend',
  reason: 'Professional assessment'
})

export const assertReadOnly = (db, read) => {
  const snapshot = () =>
    db
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map(({ name }) => db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all())
  const before = snapshot()
  db.exec('PRAGMA query_only=ON')
  try {
    read()
    assert.equal(db.isTransaction, false)
    assert.deepEqual(snapshot(), before)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.deepEqual(
      db
        .prepare('PRAGMA integrity_check')
        .all()
        .map((r) => r.integrity_check),
      ['ok']
    )
  } finally {
    db.exec('PRAGMA query_only=OFF')
  }
}
