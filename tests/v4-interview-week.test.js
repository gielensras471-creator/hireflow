import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarRange,
  createCalendarReader,
  createWeekReader,
  dayMs,
  shanghaiDay,
  shanghaiWeek,
  shiftCalendar,
  weekGroups
} from '../src/api/v4-interview-week.ts'

test('calendar reserves room for the 56px card and back layer without changing minute positions', () => {
  const start = Date.parse('2026-11-23T00:00:00+08:00')
  const rows = [0, 58, 60, 119].map((minute, index) =>
    fixture(index + 1, start + minute * 60_000)
  )
  const [day] = weekGroups(rows, start)
  assert.deepEqual(day.map((group) => group.rows.map((row) => row.id)), [[1, 2], [3, 4]])
  assert.deepEqual(day.map((group) => group.top), [0, 64])
})

test('daily and Monday-first month windows use exact Shanghai boundaries across years', () => {
  const dec31 = Date.parse('2026-12-31T22:30:00+08:00')
  const day = calendarRange(dec31, 'day')
  assert.equal(shanghaiDay(day.start), '2026-12-31')
  assert.equal(shanghaiDay(day.end), '2027-01-01')
  const january = shiftCalendar(dec31, 'month', 1)
  assert.equal(shanghaiDay(january), '2027-01-31')
  assert.equal(shanghaiDay(shiftCalendar(january, 'month', 1)), '2027-02-28')
  const month = calendarRange(january, 'month')
  assert.equal(shanghaiDay(month.start), '2026-12-28')
  assert.equal(shanghaiDay(month.end), '2027-02-01')
  const rows = [fixture(1, month.start), fixture(2, day.start), fixture(3, month.end)]
  const result = createCalendarReader(month.start, month.end).accept(page(rows, 0))
  assert.equal(result.state, 'complete')
  assert.deepEqual(
    result.rows.map((row) => row.id),
    [1, 2]
  )
  assert.equal(createCalendarReader(day.start, day.end).accept(page(rows, 0)).rows.length, 1)
})

const start = Date.parse('2026-12-28T00:00:00+08:00')
const end = start + 7 * dayMs
const fixture = (id, scheduledAt) => ({ id, scheduledAt })
const page = (rows, offset) => ({
  items: rows.slice(offset, offset + 100),
  limit: 100,
  offset,
  total: rows.length
})

test('Shanghai Monday week crosses year, with exact Sunday and Monday boundary', () => {
  assert.equal(shanghaiWeek(Date.parse('2027-01-03T23:59:59.999+08:00')), start)
  assert.equal(shanghaiWeek(end), end)
  assert.equal(shanghaiDay(start), '2026-12-28')
  assert.equal(shanghaiDay(start + 6 * dayMs), '2027-01-03')
})

test('weekly read traverses source pages, includes midnight, and excludes next Monday', () => {
  const rows = [
    ...Array.from({ length: 96 }, (_, i) => fixture(i + 1, start - 1)),
    ...Array.from({ length: 27 }, (_, i) => fixture(i + 97, start + Math.max(0, i - 1) * 1000)),
    fixture(124, end - 1),
    fixture(125, end)
  ]
  const reader = createWeekReader(start)
  assert.equal(reader.accept(page(rows, 0)).state, 'reading')
  const result = reader.accept(page(rows, reader.offset))
  assert.equal(result.state, 'complete')
  assert.equal(result.rows.length, 28)
  assert.equal(result.rows[0].scheduledAt, start)
  assert.equal(result.rows.at(-1).scheduledAt, end - 1)
  const groups = weekGroups(result.rows, start)
  assert.equal(groups[0][0].rows.length, 27)
  assert.equal(groups[0][0].rows[0].scheduledAt, groups[0][0].rows[1].scheduledAt)
  assert.equal(groups[6][0].rows[0].id, 124)
})

test('partial reads never become empty/complete under budget or observable instability', () => {
  const rows = Array.from({ length: 121 }, (_, i) => fixture(i + 1, start + i))
  const reader = createWeekReader(start)
  assert.equal(reader.accept(page(rows, 0)).state, 'reading')
  assert.equal(reader.accept({ ...page(rows, 100), total: 122 }).state, 'inconsistent')
  assert.equal(reader.offset, 100)
  const duplicate = page(rows, 100)
  duplicate.items[0] = fixture(100, start + 100)
  assert.equal(reader.accept(duplicate).state, 'inconsistent')
  assert.equal(reader.accept(page(rows, 100)).state, 'complete')
  assert.equal(createWeekReader(start, 1).accept(page(rows, 0)).state, 'budget')
})
