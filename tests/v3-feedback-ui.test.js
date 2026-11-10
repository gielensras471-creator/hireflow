import assert from 'node:assert/strict'
import test from 'node:test'
import { feedbackAllowed, feedbackTime, recommendations } from '../src/api/feedback-v3.ts'
const app = { stage: 'first_interview', applicationStatus: 'active' }
const meeting = { status: 'completed', stageScope: 'first_interview' }
test('first feedback requires active current completed interview and no existing feedback', () => {
  const check = (a = app, m = meeting, f = null) =>
    feedbackAllowed('submit', a, m, f, { canSupplement: false })
  assert.equal(check(), true)
  assert.equal(check(app, { ...meeting, status: 'scheduled' }), false)
  assert.equal(check({ ...app, applicationStatus: 'closed' }), false)
  assert.equal(check({ ...app, stage: 'second_interview' }), false)
  assert.equal(check(app, meeting, { id: 1 }), false)
})
test('historical supplement uses server eligibility and closed applications remain blocked', () => {
  const advanced = { ...app, stage: 'second_interview' }
  assert.equal(
    feedbackAllowed('supplement', advanced, meeting, null, { canSupplement: false }),
    false
  )
  assert.equal(
    feedbackAllowed('supplement', advanced, meeting, null, { canSupplement: true }),
    true
  )
  assert.equal(
    feedbackAllowed('supplement', { ...advanced, applicationStatus: 'closed' }, meeting, null, {
      canSupplement: true
    }),
    false
  )
})
test('existing feedback remains correctable after advancement or closure but no feedback is not correctable', () => {
  const closed = { stage: 'offer', applicationStatus: 'closed' }
  assert.equal(
    feedbackAllowed('correct', closed, meeting, { id: 1 }, { canSupplement: false }),
    true
  )
  assert.equal(feedbackAllowed('correct', closed, meeting, null, { canSupplement: false }), false)
})
test('feedback labels and server timestamp display use Shanghai independently of machine timezone', () => {
  assert.deepEqual(Object.keys(recommendations), ['recommend', 'not_recommend', 'undecided'])
  const ms = Date.parse('2030-01-01T06:00:00Z')
  for (const tz of ['UTC', 'America/New_York', 'Asia/Shanghai']) {
    process.env.TZ = tz
    assert.match(feedbackTime(ms), /14:00:00.*上海/)
  }
})
