import assert from 'node:assert/strict'
import test from 'node:test'
import { barRatio, unitLabel, timeKinds, workPath } from '../src/api/dashboard-v3.ts'
test('Dashboard preserves record units and creation time meaning', () => {
  assert.equal(unitLabel('interview_record'), '场面试')
  assert.equal(unitLabel('application_record'), '条申请记录')
  assert.match(timeKinds.application_created_at, /不是进入阶段时间/)
})
test('Dashboard uses bounded server paging and dedicated Offer subtype reads', () => {
  assert.equal(workPath('feedback', '', 20), '/dashboard/work-items/feedback?limit=10&offset=20')
  assert.equal(
    workPath('offer', 'accepted', 0),
    '/dashboard/offer-work-items/accepted?limit=10&offset=0'
  )
})

test('DEV-06 bar geometry shares a zero baseline and preserves data ratios', () => {
  assert.equal(barRatio(0, 0), 0)
  assert.equal(barRatio(null, 42), 0)
  assert.equal(barRatio(0, 42), 0)
  assert.equal(barRatio(21, 42), 0.5)
  assert.equal(barRatio(42, 42), 1)
  assert.equal(barRatio(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), 1)
})
