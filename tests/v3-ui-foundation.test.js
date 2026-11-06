import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  createV3Session,
  V3Error,
  v3SessionKey,
  v3TabsKey,
  v3TemporaryKey
} from '../src/utils/auth-v3.ts'
import {
  canLeave,
  safeReturn,
  shellTier,
  tabInfo,
  visit,
  visibleTabs
} from '../src/router/v3-navigation.ts'
import { startV3Local } from '../server/scripts/dev-v3-local.js'

const token = { token: 'example-v3-token', expiresAt: Date.now() + 60000 }
const hr = { id: 1, username: 'fixture', name: '虚构 HR', role: 'hr' }

function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

test('V3 sign-in verifies /me and recovers only its own remembered session', async () => {
  const local = storage({ hireflow_session: 'old V2 session' })
  const temporary = storage({ hireflow_session_temp: 'old V2 temporary session' })
  const calls = []
  const transport = {
    login: async () => {
      calls.push('login')
      return token
    },
    me: async (value) => {
      assert.equal(value, token.token)
      calls.push('me')
      return hr
    }
  }
  const session = createV3Session(transport, local, temporary)
  await session.refresh()
  assert.equal(session.state.status, 'anonymous')
  assert.deepEqual(calls, [])
  await session.signIn({ username: hr.username, password: 'fixture', remember: true })
  assert.deepEqual(calls, ['login', 'me'])
  assert.equal(session.state.user.username, hr.username)
  assert.equal(temporary.getItem(v3TemporaryKey), null)
  const restored = createV3Session(transport, local, temporary)
  assert.equal(restored.state.user, null)
  await restored.refresh()
  assert.equal(restored.state.status, 'ready')
  temporary.setItem(v3TabsKey, 'private tabs')
  restored.clear()
  assert.equal(local.getItem(v3SessionKey), null)
  assert.equal(temporary.getItem(v3TabsKey), null)
  assert.equal(local.getItem('hireflow_session'), 'old V2 session')
  assert.equal(temporary.getItem('hireflow_session_temp'), 'old V2 temporary session')
})

test('V3 non-HR, revoked role and 401/403 clear protected state independently', async () => {
  let result = { ...hr, role: 'unknown' }
  const temporary = storage()
  const session = createV3Session(
    { login: async () => token, me: async () => result },
    storage(),
    temporary
  )
  const input = { username: hr.username, password: 'fixture', remember: false }
  await session.signIn(input)
  assert.equal(session.state.status, 'forbidden')
  assert.equal(session.state.user, null)
  result = { ...hr, role: '招聘管理员' }
  await session.signIn(input)
  assert.equal(session.state.status, 'ready')
  assert.ok(temporary.getItem(v3TemporaryKey))
  session.reject('stale-token', 401, session.version())
  assert.equal(session.state.status, 'ready')
  result = { ...hr, role: 'revoked' }
  await session.refresh()
  assert.equal(session.state.status, 'forbidden')
  assert.equal(temporary.getItem(v3TemporaryKey), null)
  result = { ...hr, role: 'admin' }
  await session.signIn(input)
  session.reject(token.token, 403, session.version())
  assert.equal(session.state.expired, false)
  assert.equal(session.state.status, 'forbidden')
  await session.signIn(input)
  session.reject(token.token, 401, session.version())
  assert.equal(session.state.status, 'anonymous')
})

test('V3 transient identity failures hide prior user and a delayed response cannot undo logout', async () => {
  const temporary = storage({ [v3TemporaryKey]: JSON.stringify(token) })
  let finish
  const session = createV3Session(
    {
      login: async () => token,
      me: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    },
    storage(),
    temporary
  )
  const pending = session.refresh()
  await Promise.resolve()
  session.clear()
  finish(hr)
  await pending
  assert.equal(session.state.status, 'anonymous')
  assert.equal(session.state.user, null)
  const unavailable = createV3Session(
    {
      login: async () => token,
      me: async () => {
        throw new V3Error(503, 'BUSY', 'fixture')
      }
    },
    storage(),
    storage({ [v3TemporaryKey]: JSON.stringify(token) })
  )
  await unavailable.refresh()
  assert.equal(unavailable.state.status, 'unavailable')
  assert.equal(unavailable.state.user, null)
})

test('V3 tabs use canonical IDs, keep MRU visible and reject unsafe deep links', () => {
  assert.equal(safeReturn('//example.com'), '/dashboard')
  assert.equal(safeReturn('/candidates/../profile'), '/dashboard')
  assert.equal(safeReturn('/candidates/6?q=one'), '/candidates/6?q=one')
  assert.equal(tabInfo('/candidates/9007199254740992'), null)
  const tabs = [
    '/dashboard',
    '/positions',
    '/candidates',
    '/interviews',
    '/candidates/6',
    '/candidates/7',
    '/candidates/6?q=one'
  ].reduce((list, target) => visit(list, target.split('?')[0], target), [])
  assert.equal(tabs.length, 6)
  assert.equal(tabs[0].target, '/candidates/6?q=one')
  assert.equal(tabs[1].key, '/candidates/7')
  for (const [width, limit, sidebar] of [
    [1440, 5, 230],
    [1280, 5, 230],
    [1100, 3, 72],
    [960, 3, 72],
    [959, 1, 0],
    [390, 1, 0]
  ]) {
    const tier = shellTier(width)
    assert.equal(tier.sidebar, sidebar)
    const shown = visibleTabs(tabs, tier.limit)
    assert.equal(shown.visible.length, limit)
    assert.equal(shown.visible[0].key, tabs[0].key)
    assert.equal(shown.overflow.length, 6 - limit)
  }
  assert.equal(canLeave(false, assert.fail), true)
  assert.equal(
    canLeave(true, () => false),
    false
  )
  assert.equal(
    canLeave(true, () => true),
    true
  )
})

test('V3 local launcher requires opt-in and refuses production', () => {
  const script = 'server/scripts/dev-v3-local.js'
  const noFlag = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(noFlag.status, 1)
  assert.match(noFlag.stderr, /Use pnpm dev:v3/)
  const production = spawnSync(process.execPath, [script, '--local'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production' }
  })
  assert.equal(production.status, 1)
  assert.match(production.stderr, /disabled in production/)
})

test('V3 local loopback proxy reaches its fresh isolated API and has no V2 API upstream', async () => {
  const app = await startV3Local({ port: 0 })
  try {
    assert.equal(new URL(app.url).hostname, '127.0.0.1')
    assert.deepEqual(await (await fetch(app.url + '/api/v3/health')).json(), { status: 'ok' })
    const login = await fetch(app.url + '/api/v3/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: app.username, password: app.password })
    })
    assert.equal(login.status, 200)
    const headers = { Authorization: 'Bearer ' + (await login.json()).token }
    const user = await (await fetch(app.url + '/api/v3/auth/me', { headers })).json()
    assert.equal(user.role, 'hr')
    const positions = await (await fetch(app.url + '/api/v3/positions', { headers })).json()
    assert.equal(positions.total, 0)
    const v2 = await fetch(app.url + '/api/profile', { headers: { Accept: 'application/json' } })
    assert.equal(v2.status, 404)
  } finally {
    await app.close()
  }
})

test('V3 expiry notice follows the invalidated session and is never persisted', async () => {
  const local = storage()
  const temporary = storage()
  const input = { username: hr.username, password: 'fixture', remember: true }
  let unauthorized = false
  const transport = {
    login: async () => token,
    me: async () => {
      if (unauthorized) throw new V3Error(401, 'INVALID_TOKEN', 'fixture')
      return hr
    }
  }
  const anonymous = createV3Session(transport, local, temporary)
  await anonymous.refresh()
  assert.equal(anonymous.state.expired, false)

  local.setItem(v3SessionKey, JSON.stringify({ ...token, expiresAt: 0 }))
  const expired = createV3Session(transport, local, temporary)
  await expired.refresh()
  assert.equal(expired.state.expired, true)
  assert.equal(local.getItem(v3SessionKey), null)

  await expired.signIn(input)
  assert.equal(expired.state.expired, false)
  unauthorized = true
  await expired.refresh()
  assert.equal(expired.state.expired, true)
  assert.equal(expired.state.user, null)
  unauthorized = false

  await expired.signIn(input)
  const oldVersion = expired.version()
  await expired.signIn(input)
  expired.reject(token.token, 401, oldVersion)
  assert.equal(expired.state.status, 'ready')
  assert.equal(expired.state.expired, false)
  expired.reject(token.token, 401, expired.version())
  assert.equal(expired.state.expired, true)
  await expired.signIn(input)
  assert.equal(expired.state.expired, false)
  expired.clear()
  assert.equal(expired.state.expired, false)
  assert.equal(local.getItem(v3SessionKey), null)
})
