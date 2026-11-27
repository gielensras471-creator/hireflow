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
  positionSource,
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

test('profile refresh after a write waits for any stale identity read and requests current facts', async () => {
  let resolveOld
  let reads = 0
  const session = createV3Session(
    {
      login: async () => token,
      me: async () => {
        reads++
        if (reads === 2)
          return new Promise((resolve) => {
            resolveOld = resolve
          })
        return reads === 1 ? hr : { ...hr, name: '已更新的虚构姓名' }
      }
    },
    storage(),
    storage()
  )
  await session.signIn({ username: hr.username, password: 'fixture', remember: false })
  const stale = session.refresh()
  await Promise.resolve()
  const current = session.refreshAfterWrite()
  resolveOld(hr)
  await Promise.all([stale, current])
  assert.equal(reads, 3)
  assert.equal(session.state.user.name, '已更新的虚构姓名')
})

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

for (const remember of [true, false]) {
  test(`V3 retries the initial identity check before storing the session (remember=${remember})`, async () => {
    const local = storage()
    const temporary = storage()
    let offline = true
    let logins = 0
    const transport = {
      login: async () => {
        logins++
        return token
      },
      me: async () => {
        if (offline) throw new V3Error(0, 'NETWORK', 'fixture')
        return hr
      }
    }
    const session = createV3Session(transport, local, temporary)
    const target = remember ? local : temporary
    const key = remember ? v3SessionKey : v3TemporaryKey
    const other = remember ? temporary : local
    const otherKey = remember ? v3TemporaryKey : v3SessionKey

    await session.signIn({ username: hr.username, password: 'fixture', remember })
    assert.equal(session.state.status, 'unavailable')
    assert.equal(session.token(), token.token)
    assert.equal(target.getItem(key), null)
    assert.equal(other.getItem(otherKey), null)

    offline = false
    await session.refresh()
    assert.equal(session.state.status, 'ready')
    assert.deepEqual(JSON.parse(target.getItem(key)), token)
    assert.equal(other.getItem(otherKey), null)
    assert.equal(logins, 1)

    const restored = createV3Session(transport, local, temporary)
    offline = true
    await restored.refresh()
    assert.equal(restored.state.status, 'unavailable')
    assert.deepEqual(JSON.parse(target.getItem(key)), token)

    offline = false
    await restored.refresh()
    assert.equal(restored.state.status, 'ready')
    assert.deepEqual(restored.state.user, hr)
    restored.clear()
    assert.equal(target.getItem(key), null)
  })
}

for (const outcome of ['logout', 401, 403, 'role']) {
  test(`V3 never stores an unverified session after ${outcome}`, async () => {
    const local = storage()
    const temporary = storage()
    let checks = 0
    const session = createV3Session(
      {
        login: async () => token,
        me: async () => {
          if (++checks === 1) throw new V3Error(0, 'NETWORK', 'fixture')
          if (outcome === 'role') return { ...hr, role: 'viewer' }
          throw new V3Error(outcome, 'DENIED', 'fixture')
        }
      },
      local,
      temporary
    )
    await session.signIn({ username: hr.username, password: 'fixture', remember: true })
    assert.equal(session.state.status, 'unavailable')
    if (outcome === 'logout') session.clear()
    await session.refresh()
    assert.equal(
      session.state.status,
      outcome === 'logout' || outcome === 401 ? 'anonymous' : 'forbidden'
    )
    assert.equal(session.state.expired, outcome === 401)
    assert.equal(session.token(), undefined)
    assert.equal(local.getItem(v3SessionKey), null)
    assert.equal(temporary.getItem(v3TemporaryKey), null)
    if (outcome === 'logout') assert.equal(checks, 1)
  })
}

for (const replacement of ['logout', 'new sign-in']) {
  test(`V3 late identity retry cannot overwrite ${replacement}`, async () => {
    const local = storage()
    const temporary = storage()
    const replacementUser = { ...hr, id: 2, username: 'another-fixture' }
    // A token string may repeat, so generation must still separate the two requests.
    let release
    let checks = 0
    const session = createV3Session(
      {
        login: async () => token,
        me: async () => {
          if (++checks === 1) throw new V3Error(0, 'NETWORK', 'fixture')
          if (checks === 2)
            return new Promise((resolve) => {
              release = resolve
            })
          return replacementUser
        }
      },
      local,
      temporary
    )
    await session.signIn({ username: hr.username, password: 'fixture', remember: true })
    const retry = session.refresh()
    await Promise.resolve()
    if (replacement === 'logout') session.clear()
    else
      await session.signIn({
        username: replacementUser.username,
        password: 'fixture',
        remember: false
      })
    release(hr)
    await retry
    assert.equal(local.getItem(v3SessionKey), null)
    if (replacement === 'logout') {
      assert.equal(session.state.status, 'anonymous')
      assert.equal(session.state.user, null)
      assert.equal(temporary.getItem(v3TemporaryKey), null)
    } else {
      assert.equal(session.state.status, 'ready')
      assert.deepEqual(session.state.user, replacementUser)
      assert.deepEqual(JSON.parse(temporary.getItem(v3TemporaryKey)), token)
    }
  })
}

test('V3 does not store a session that expires while /me retry is in flight', async (t) => {
  const freshToken = { ...token, expiresAt: 2000 }
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const local = storage()
  const temporary = storage()
  let checks = 0
  const session = createV3Session(
    {
      login: async () => freshToken,
      me: async () => {
        if (++checks === 1) throw new V3Error(0, 'NETWORK', 'fixture')
        now = freshToken.expiresAt
        return hr
      }
    },
    local,
    temporary
  )
  await session.signIn({ username: hr.username, password: 'fixture', remember: false })
  await session.refresh()
  assert.equal(session.state.status, 'anonymous')
  assert.equal(session.state.expired, true)
  assert.equal(session.token(), undefined)
  assert.equal(local.getItem(v3SessionKey), null)
  assert.equal(temporary.getItem(v3TemporaryKey), null)
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
  assert.deepEqual(tabInfo('/positions/6'), { key: '/positions/6', title: '职位 #6' })
  assert.equal(tabInfo('/positions/0'), null)
  assert.equal(tabInfo('/positions/9007199254740992'), null)
  assert.equal(safeReturn('/positions/6?from=%2Fdashboard'), '/positions/6?from=%2Fdashboard')
  assert.equal(safeReturn('/positions/../profile'), '/dashboard')
  assert.equal(positionSource('/positions?view=table&offset=10'), '/positions?view=table&offset=10')
  assert.equal(positionSource('/dashboard'), '/dashboard')
  assert.equal(positionSource('//elsewhere.test'), '/positions')
  assert.equal(positionSource('/positions/6'), '/positions')

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
    const editorShortcut = await fetch(app.url + '/__open-in-editor')
    assert.equal(editorShortcut.status, 404)
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
