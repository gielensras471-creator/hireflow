import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { canSchedule, shanghaiInput, interviewQuery } from '../src/api/interview-v3.ts'

test('Shanghai input preserves explicit business time and rejects invalid dates', () => {
  assert.equal(shanghaiInput('2030-01-01T14:00'), '2030-01-01T14:00:00+08:00')
  assert.equal(shanghaiInput('2030-01-01T14:00:01'), '2030-01-01T14:00:01+08:00')
  for (const value of ['2030-02-30T14:00', '2030-13-01T14:00', '2030-01-01T25:00', 'not a time'])
    assert.throws(() => shanghaiInput(value))
})
test('Shanghai input is invariant under different host timezones', () => {
  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { shanghaiInput } from './src/api/interview-v3.ts'; console.log(shanghaiInput('2030-01-01T14:00'))"
      ],
      { encoding: 'utf8', env: { ...process.env, TZ: tz } }
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '2030-01-01T14:00:00+08:00')
  }
})
test('booking eligibility distinguishes stage, lifecycle and pending appointments', () => {
  for (const stage of ['first_interview', 'second_interview']) {
    const active = { stage, applicationStatus: 'active' }
    assert.equal(canSchedule(active, []), true)
    assert.equal(canSchedule(active, [{ status: 'completed' }, { status: 'cancelled' }]), true)
    assert.equal(canSchedule(active, [{ status: 'scheduled' }]), false)
    assert.equal(canSchedule({ ...active, applicationStatus: 'closed' }, []), false)
  }
  for (const stage of ['screening', 'offer'])
    assert.equal(canSchedule({ stage, applicationStatus: 'active' }, []), false)
})
test('interview paging only forwards the accepted query contract', () => {
  const query = new URLSearchParams(
    interviewQuery({
      applicationId: '1',
      positionId: '2',
      stageScope: 'first_interview',
      status: 'scheduled',
      offset: '20',
      q: 'unsupported',
      limit: '10000'
    })
  )
  assert.equal(query.get('q'), null)
  assert.equal(query.get('limit'), '20')
  assert.equal(query.get('offset'), '20')
  assert.equal(query.get('positionId'), '2')
  assert.equal(new URLSearchParams(interviewQuery({ offset: '-1' })).get('offset'), '0')
})
