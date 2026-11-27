import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableOffset,
  byPublishDate,
  collectPositions,
  listParams,
  validOffset,
  verifyPage
} from '../src/api/v4-recruiting-lists.ts'

const positions = Array.from({ length: 121 }, (_, index) => ({
  id: index + 1,
  version: 1,
  status: 'open',
  deletedAt: null,
  publishDate: index === 0 ? '2026-02-30' : index > 100 ? '2026-12-31' : '2026-10-01'
}))
const chunk = (rows, offset, limit) => ({
  items: rows.slice(offset, offset + limit),
  total: rows.length,
  limit,
  offset
})

test('published position sort validates multiple source pages, breaks ties by ID and puts invalid dates last', async () => {
  const calls = []
  const snapshot = await collectPositions(
    async (offset, limit) => {
      calls.push([offset, limit])
      return chunk(positions, offset, limit)
    },
    () => true
  )
  assert.deepEqual(calls, [
    [0, 100],
    [100, 100],
    [0, 100],
    [100, 100]
  ])
  const sorted = byPublishDate(snapshot)
  assert.deepEqual(
    sorted.slice(0, 9).map(({ id }) => id),
    [102, 103, 104, 105, 106, 107, 108, 109, 110]
  )
  assert.equal(sorted[sorted.length - 1].id, 1)
  assert.equal(new Set(sorted.map(({ id }) => id)).size, 121)
})

test('position read stops on cap, stale query, duplicate IDs, or a changing snapshot', async () => {
  await assert.rejects(
    collectPositions(
      async (offset, limit) => ({
        ...chunk(positions, offset, limit),
        total: 301
      }),
      () => true
    ),
    /超过 300/
  )
  await assert.rejects(
    collectPositions(
      async () => {
        throw new Error('should not issue a request')
      },
      () => false
    ),
    /已更新/
  )
  let calls = 0
  await assert.rejects(
    collectPositions(
      async (offset, limit) => {
        const rows =
          ++calls > 2
            ? positions.map((row) => (row.id === 11 ? { ...row, version: 2 } : row))
            : positions
        return chunk(rows, offset, limit)
      },
      () => true
    ),
    /发生变化/
  )
  assert.throws(
    () => verifyPage({ items: [positions[1]], total: 21, limit: 10, offset: 20 }, 20, 10, 21, 2),
    /发生变化/
  )
  assert.throws(
    () => verifyPage({ items: [], total: 19, limit: 10, offset: 20 }, 20, 10, 21, 20),
    /发生变化/
  )
})

test('list query keeps different contract fields, all lifecycles and bounded page offsets', () => {
  const params = listParams(
    { stage: 'offer', positionId: '8', applicationStatus: 'all', view: 'table', sort: 'published' },
    false,
    10,
    20
  )
  assert.deepEqual(Object.fromEntries(params), {
    limit: '10',
    offset: '20',
    stage: 'offer',
    positionId: '8'
  })
  assert.equal(validOffset('19', 9), 18)
  assert.equal(validOffset('-90', 9), 0)
  assert.equal(availableOffset(21, 450, 10), 20)
  assert.equal(availableOffset(0, 450, 10), 0)
})
