import assert from 'node:assert/strict'
import test from 'node:test'
import { unitLabel, timeKinds, workPath } from '../src/api/dashboard-v3.ts'
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
