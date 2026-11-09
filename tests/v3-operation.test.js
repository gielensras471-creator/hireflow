import assert from 'node:assert/strict'
import test from 'node:test'
import { createWriteIntent, latestRead } from '../src/api/v3-operation.ts'

test('uncertain creates replay the same key and payload, rejecting changed intent until resolved', async () => {
  let keys = 0
  const command = createWriteIntent(() => String(++keys))
  const observed = []
  const body = { name: '虚构申请', positionId: 1 }
  await assert.rejects(
    command.execute(
      body,
      async (key) => {
        observed.push(key)
        throw { status: 0 }
      },
      (error) => error.status
    )
  )
  await assert.rejects(
    command.execute(
      { ...body, name: 'changed' },
      async () => 0,
      (error) => error.status
    ),
    /RESOLVE_PREVIOUS_REQUEST/
  )
  assert.equal(
    await command.execute(
      body,
      async (key) => {
        observed.push(key)
        return 1
      },
      (error) => error.status
    ),
    1
  )
  assert.deepEqual(observed, ['1', '1'])
  assert.equal(command.uncertain, false)
})

test('pending writes cannot overlap and a version conflict requires a new intent', async () => {
  let keys = 0
  const command = createWriteIntent(() => String(++keys))
  let finish
  const pending = command.execute(
    { version: 1 },
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    () => 0
  )
  await assert.rejects(
    command.execute(
      { version: 1 },
      async () => 0,
      () => 0
    ),
    /REQUEST_PENDING/
  )
  finish(1)
  await pending
  await assert.rejects(
    command.execute(
      { version: 1 },
      async () => {
        throw { status: 409 }
      },
      (error) => error.status
    )
  )
  await command.execute(
    { version: 2 },
    async (key) => assert.equal(key, '3'),
    (error) => error.status
  )
})

test('out-of-order reads and failures never overwrite the latest filter result', async () => {
  const query = latestRead()
  const accepted = []
  let finish
  const old = query.execute(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    (value) => accepted.push(value),
    assert.fail
  )
  await query.execute(
    async () => 'new-filter',
    (value) => accepted.push(value),
    assert.fail
  )
  finish('old-filter')
  await old
  assert.deepEqual(accepted, ['new-filter'])
})
import { createV3Session, V3Error } from '../src/utils/auth-v3.ts'

test('identity network failures preserve the mounted user until recovery or real revocation', async () => {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  }
  let failure = false
  let role = 'hr'
  const session = createV3Session(
    {
      login: async () => ({ token: 'fixture', expiresAt: Date.now() + 60000 }),
      me: async () => {
        if (failure) throw new V3Error(0, 'NETWORK', 'fixture')
        return { id: 1, username: 'hr', name: '虚构 HR', role }
      }
    },
    storage,
    storage
  )
  await session.signIn({ username: 'hr', password: 'fixture', remember: false })
  failure = true
  await session.refresh()
  assert.equal(session.state.status, 'unavailable')
  assert.equal(session.state.user.name, '虚构 HR')
  failure = false
  await session.refresh()
  assert.equal(session.state.status, 'ready')
  role = 'viewer'
  await session.refresh()
  assert.equal(session.state.status, 'forbidden')
  assert.equal(session.state.user, null)
})
