import test from 'node:test'
import assert from 'node:assert/strict'
import { canAdvance, sameTransition, preflightSignature } from '../src/api/advancement-v3.ts'
const p = {
  applicationId: 1,
  version: 1,
  fromStage: 'first_interview',
  toStage: 'second_interview',
  canAdvance: true,
  canAdvanceWithReason: false,
  blockedReason: null,
  reasonRequired: false,
  reasonType: null,
  scheduled: [],
  completed: [],
  cancelled: [],
  completedCount: 0,
  missingInterviewIds: []
}
test('server gates block scheduled, closed and final-stage advancements', () => {
  assert.equal(canAdvance(p), true)
  assert.equal(canAdvance({ ...p, scheduled: [{ interviewId: 2 }] }), false)
  assert.equal(canAdvance({ ...p, blockedReason: 'APPLICATION_CLOSED' }), false)
  assert.equal(canAdvance({ ...p, toStage: null }), false)
  assert.equal(canAdvance({ ...p, canAdvance: false, canAdvanceWithReason: false }), false)
  assert.equal(canAdvance({ ...p, canAdvance: false, canAdvanceWithReason: true }), true)
})
test('old intent cannot become a later-stage advancement after a conflict', () => {
  assert.equal(sameTransition(p, { ...p, version: 2 }), true)
  assert.equal(sameTransition(p, { ...p, fromStage: 'second_interview', toStage: 'offer' }), false)
})
test('preflight comparison notices changed version, missing list and evaluation facts regardless of object key order', () => {
  assert.equal(
    preflightSignature(p),
    preflightSignature(Object.fromEntries(Object.entries(p).reverse()))
  )
  for (const changed of [
    { version: 2 },
    { missingInterviewIds: [2, 3] },
    { reasonType: 'skip_evaluation' },
    { scheduled: [{ interviewId: 4, status: 'scheduled' }] }
  ])
    assert.notEqual(preflightSignature(p), preflightSignature({ ...p, ...changed }))
})
