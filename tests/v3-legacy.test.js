import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { fixture, insert } from './helpers/v3-db.js'
import { createHistoryService } from '../server/services/history-service.js'
import { createV3App } from '../server/app-v3.js'
const prepare = (t) => {
  const f = fixture(t)
  f.db
    .prepare("UPDATE users SET role='hr',password_hash=? WHERE id=1")
    .run(bcrypt.hashSync('fictional-ac16-test', 4))
  for (const [source, id, type, status] of [
    ['b', 2, 'interviews', 'not_applicable'],
    ['a', 3, 'candidates', 'ambiguous'],
    ['a', 1, 'candidates', 'no_match']
  ])
    insert(f.db, 'legacy_records', {
      source_key: source,
      entity_type: type,
      legacy_id: id,
      raw_json: JSON.stringify({ stage: 'offer', name: 'PRIVATE_NOT_FOR_DTO' }),
      facts_json: JSON.stringify({ stage: 'offer' }),
      mapping_status: status,
      mapped_position_id: null,
      imported_at: 100
    })
  return f
}
test('AC16 legacy page has stable composite ordering, bounded filtering and no private JSON', (t) => {
  const f = prepare(t),
    context = {},
    service = createHistoryService({ db: f.db, resolveActor: (c) => (c === context ? 1 : null) })
  f.db.exec('PRAGMA query_only=ON')
  const a = service.legacyPage(context, { limit: 1, offset: 0 }),
    b = service.legacyPage(context, { limit: 1, offset: 1 })
  assert.equal(a.total, 3)
  assert.equal(a.items[0].legacyId, 1)
  assert.equal(b.items[0].legacyId, 3)
  assert.equal(
    service.legacyPage(context, { mappingStatus: 'ambiguous', entityType: 'candidates' }).total,
    1
  )
  assert.equal(service.legacyPage(context, { sourceKey: 'b' }).total, 1)
  assert.equal(service.legacyPage(context, { offset: 20 }).items.length, 0)
  assert.ok(!JSON.stringify(a).includes('PRIVATE_NOT_FOR_DTO'))
  for (const options of [
    { limit: 101 },
    { offset: -1 },
    { entityType: 'users' },
    { mappingStatus: 'x' },
    { sourceKey: '' },
    { raw: true }
  ])
    assert.throws(() => service.legacyPage(context, options), { code: 'INVALID_QUERY' })
  assert.throws(() => service.legacyPage({}, {}), { code: 'INVALID_ACTOR' })
})
test('AC16 HTTP list/detail require current HR, reject unapproved queries and never expose private fields', async (t) => {
  const f = prepare(t),
    server = createV3App({
      db: f.db,
      authConfig: { jwtSecret: randomBytes(48).toString('hex') }
    }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  t.after(() => new Promise((r) => server.close(r)))
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v3'
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hr-test', password: 'fictional-ac16-test' })
  })
  const token = (await login.json()).token
  const get = (q, auth = token) =>
    fetch(base + q, { headers: auth ? { Authorization: 'Bearer ' + auth } : {} })
  assert.equal((await get('/legacy-records/list', null)).status, 401)
  const response = await get('/legacy-records/list?limit=1&offset=1'),
    page = await response.json()
  assert.equal(response.status, 200)
  assert.equal(page.items[0].legacyId, 3)
  const detail = await get('/legacy-records?sourceKey=a&entityType=candidates&legacyId=3')
  assert.equal(detail.status, 200)
  assert.ok(!JSON.stringify(await detail.json()).includes('PRIVATE_NOT_FOR_DTO'))
  for (const q of [
    '?limit=101',
    '?offset=-1',
    '?entityType=users',
    '?raw=true',
    '?limit=1&limit=2',
    '?mappingStatus=x'
  ])
    assert.equal((await get('/legacy-records/list' + q)).status, 400)
  f.db.prepare("UPDATE users SET role='viewer' WHERE id=1").run()
  assert.equal((await get('/legacy-records/list')).status, 403)
})
