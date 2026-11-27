import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDemoServer } from '../server/index-demo-v3.js'
import {
  createWorkPreferences,
  preferenceDefaults,
  preferenceKey,
  optionalSessionStorage
} from '../src/utils/v4-work-preferences.ts'

test('work preferences isolate stable identity and runtime; clear only discards the active session', () => {
  const stored = new Map()
  const storage = () => ({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value)
  })
  const formal = createWorkPreferences('formal', storage)
  const demo = createWorkPreferences('demo', storage)
  assert.deepEqual(formal.read(1), preferenceDefaults)
  assert.equal(formal.save(1, { candidates: 'table', interviews: 'month' }), true)
  assert.deepEqual(formal.read(2), preferenceDefaults)
  assert.deepEqual(demo.read(1), preferenceDefaults)
  formal.clear()
  assert.deepEqual(formal.read(1), { candidates: 'table', interviews: 'month' })
  assert.deepEqual(createWorkPreferences('formal', storage).read(1), formal.read(1))
  for (const [id, value] of [
    [3, '{'],
    [4, '{"version":2,"candidates":"table"}'],
    [5, '{"version":1,"candidates":"focus","interviews":"list"}']
  ]) {
    stored.set(preferenceKey('formal', id), value)
    assert.deepEqual(formal.read(id), preferenceDefaults)
  }
})
test('blocked storage preserves only a legal current preference and does not throw from session storage', () => {
  const blocked = () => {
    throw new Error('storage restricted')
  }
  const prefs = createWorkPreferences('demo', blocked)
  assert.deepEqual(prefs.read(1), preferenceDefaults)
  assert.equal(prefs.save(1, { candidates: 'table', interviews: 'month' }), false)
  assert.deepEqual(prefs.read(1), { candidates: 'table', interviews: 'month' })
  prefs.clear()
  assert.deepEqual(prefs.read(1), preferenceDefaults)
  const browser = optionalSessionStorage(blocked)
  assert.equal(browser.getItem('test'), null)
  browser.setItem('test', 'test')
  browser.removeItem('test')
})

test('Demo restart invalidates the old session but the same identity recovers local preferences', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hf-prefs-demo-'))
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Demo</title>')
  await writeFile(
    join(directory, 'demo-build.json'),
    JSON.stringify({ kind: 'hireflow-isolated-demo', apiBase: '/api/v3' })
  )
  const values = new Map()
  const prefs = createWorkPreferences('demo', () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }))
  let app
  const open = () => startDemoServer({ port: 0, staticDir: directory })
  const request = async (path, options) =>
    fetch('http://127.0.0.1:' + app.server.address().port + '/api/v3/auth/' + path, options)
  const login = async () => {
    const response = await request('login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo_admin', password: 'a123456' })
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    app = await open()
    const first = await login()
    prefs.save(first.user.id, { candidates: 'table', interviews: 'day' })
    await app.close()
    prefs.clear()
    app = await open()
    const stale = await request('me', { headers: { Authorization: 'Bearer ' + first.token } })
    assert.equal(stale.status, 401)
    const second = await login()
    assert.equal(second.user.id, first.user.id)
    assert.deepEqual(prefs.read(second.user.id), { candidates: 'table', interviews: 'day' })
  } finally {
    if (app) await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
