import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMigrationSandbox } from '../server/db/migration-sandbox.js'
const position = (id, title) => ({
  id,
  title,
  department: 'Test',
  location: 'Test',
  status: 'open',
  candidate_count: 99,
  publish_date: '2026-11-03',
  description: 'Fictional'
})
const candidate = (id, position, stage) => ({
  id,
  name: 'Fictional ' + id,
  position,
  education: '',
  school: '',
  phone: '',
  email: '',
  stage,
  owner: 'Fixture',
  applied_date: '2026-11-03'
})
const interview = (id, candidate_id, date, time) => ({
  id,
  candidate_id,
  candidate_name: 'Fictional',
  position: 'Unique',
  date,
  time,
  interviewer: 'Fixture',
  type: 'Unknown round',
  status: 'completed'
})
const fixture = () => ({
  positions: [
    position(1, 'Unique'),
    position(2, 'Duplicate'),
    position(3, 'Duplicate'),
    { ...position(4, 'Invalid'), publish_date: '2026-02-30' }
  ],
  candidates: [
    candidate(1, 'Unique', 'screening'),
    candidate(2, 'Missing', 'rejected'),
    candidate(3, 'Duplicate', 'offer'),
    candidate(4, 'Invalid', 'unknown')
  ],
  interviews: [
    interview(1, 1, '2026-11-03', '10:00'),
    interview(2, 999, 'bad', ''),
    interview(3, 2, '', '25:99')
  ]
})
const setup = (t) => {
  const box = createMigrationSandbox()
  t.after(() => box.dispose())
  return box
}

test('DEV-03 archives every fictional row, retains unknown facts, stable position mappings and source WAL', async (t) => {
  const b = setup(t),
    source = await b.createSource('source.db', fixture())
  assert(source.walBytes > 0)
  assert(source.backup.reopened)
  const original = await b.inspect('source.db')
  await b.createTarget('target.db')
  const report = await b.migrate('source.db', 'target.db', { executor: 'isolated-test' })
  assert.deepEqual(report.sourceCounts, { positions: 4, candidates: 4, interviews: 3 })
  assert.deepEqual(report.archiveCounts, report.sourceCounts)
  assert.deepEqual(report.matching, { unique_match: 1, no_match: 1, ambiguous: 2 })
  assert.equal(report.positions.length, 3)
  assert.equal(report.invalidPositions, 1)
  assert.deepEqual(report.targetCheck, { foreignKeys: [], integrity: ['ok'] })
  const target = await b.inspect('target.db')
  assert.equal(target.counts.legacy_records, 11)
  for (const table of ['candidates', 'interviews', 'feedback', 'business_events'])
    assert.equal(target.counts[table], 0)
  for (const row of target.rows.legacy_records)
    assert.deepEqual(JSON.parse(row.raw_json), {
      ...original.rows[row.entity_type].find((r) => r.id === row.legacy_id)
    })
  const facts = (id) =>
    JSON.parse(
      target.rows.legacy_records.find((r) => r.entity_type === 'candidates' && r.legacy_id === id)
        .facts_json
    )
  assert.equal(facts(2).outcome, 'company_rejected')
  assert.equal(facts(2).stage, null)
  assert.equal(facts(2).closed_at, null)
  assert.equal(facts(3).offer_status, null)
  assert.equal(facts(4).stage, null)
  assert.deepEqual(await b.inspect('source.db'), original)
  const repeated = await b.migrate('source.db', 'target.db', { executor: 'isolated-test' })
  assert.equal(repeated.status, 'already_applied')
  assert.deepEqual(await b.inspect('target.db'), target)
  console.log('DEV-03 fictional migration report:', JSON.stringify(report))
})

test('DEV-03 fingerprints ignore insertion order; different sources and script digests are rejected', async (t) => {
  const b = setup(t),
    f = fixture()
  await b.createSource('a.db', f)
  await b.createSource(
    'b.db',
    Object.fromEntries(Object.entries(f).map(([k, v]) => [k, [...v].reverse()]))
  )
  await b.createTarget('target.db')
  const a = await b.migrate('a.db', 'target.db', { executor: 'test' })
  assert.equal(
    (await b.migrate('b.db', 'target.db', { executor: 'test' })).source_fingerprint,
    a.source_fingerprint
  )
  await b.createSource('changed.db', {
    ...f,
    candidates: [...f.candidates, candidate(5, 'Unique', 'offer')]
  })
  await assert.rejects(b.migrate('changed.db', 'target.db', { executor: 'test' }), /differs/)
  await assert.rejects(
    b.migrate('a.db', 'target.db', { executor: 'test', expectedScriptSha256: '0'.repeat(64) }),
    /digest mismatch/
  )
})

test('DEV-03 failure after partial writes rolls back; backup restores into a new reopenable file', async (t) => {
  const b = setup(t)
  await b.createSource('source.db', fixture())
  await b.createTarget('target.db')
  const before = await b.inspect('target.db')
  let failure
  try {
    await b.migrate('source.db', 'target.db', { executor: 'test', failAfterArchive: 5 })
  } catch (e) {
    failure = e
  }
  assert.match(failure.message, /Injected/)
  assert.equal(failure.report.rollback, true)
  assert.deepEqual(await b.inspect('target.db'), before)
  const restored = await b.restore(failure.report.backup.file, 'restored.db')
  assert(restored.reopened)
  assert.deepEqual(await b.inspect('restored.db'), before)
  const sourceRestore = await b.restore('source-initial-backup.db', 'source-restored.db')
  assert(sourceRestore.reopened)
  assert.deepEqual(await b.inspect('source-restored.db'), await b.inspect('source.db'))
  await assert.rejects(b.restore('source-initial-backup.db', 'source.db'), /already exists/)
})

test('DEV-03 path traversal, arbitrary paths, existing files, symlinks and foreign sources are refused', async (t) => {
  const b = setup(t),
    other = setup(t)
  for (const name of [
    '../escape.db',
    path.join(b.root, 'absolute.db'),
    'nested/a.db',
    'file:source.db',
    'C:\\business.db'
  ])
    await assert.rejects(b.createTarget(name), /sandbox/)
  await b.createTarget('target.db')
  await assert.rejects(b.createTarget('target.db'), /already exists/)
  fs.writeFileSync(path.join(b.root, 'existing.db'), 'untouched')
  await assert.rejects(b.createTarget('existing.db'), /already exists/)
  assert.equal(fs.readFileSync(path.join(b.root, 'existing.db'), 'utf8'), 'untouched')
  await assert.rejects(b.inspect('existing.db'), /Unregistered/)
  await other.createSource('other.db', fixture())
  await assert.rejects(
    b.migrate(path.join(other.root, 'other.db'), 'target.db', { executor: 'test' }),
    /sandbox/
  )
  const link = path.join(b.root, 'linked')
  fs.symlinkSync(other.root, link, 'junction')
  try {
    await assert.rejects(b.createTarget('linked/escape.db'), /sandbox/)
  } finally {
    fs.unlinkSync(link)
  }
  const saved = b.root + '-saved'
  fs.renameSync(b.root, saved)
  fs.symlinkSync(other.root, b.root, 'junction')
  try {
    await assert.rejects(b.inspect('target.db'), /Invalid owned/)
  } finally {
    fs.unlinkSync(b.root)
    fs.renameSync(saved, b.root)
  }
})

test('DEV-03 refuses populated targets and corrupted backups, preserves source and existing destinations', async (t) => {
  const b = setup(t)
  await b.createSource('source.db', fixture())
  await b.createTarget('target.db')
  const db = new DatabaseSync(path.join(b.root, 'target.db'))
  db.exec(
    "INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES ('fixture','fake','test','test','','','')"
  )
  db.close()
  await assert.rejects(b.migrate('source.db', 'target.db', { executor: 'test' }), /contains data/)
  await b.backup('target.db', 'backup.db')
  fs.writeFileSync(path.join(b.root, 'backup.db'), 'corrupted test backup')
  await assert.rejects(b.restore('backup.db', 'restore.db'), /database|malformed/i)
  assert.equal((await b.inspect('target.db')).counts.users, 1)
})

test('DEV-03 retries rolled-back imports, rejects changed target schema and recorded script digest', async (t) => {
  const b = setup(t)
  await b.createSource('source.db', fixture())
  await b.createTarget('retry.db')
  await assert.rejects(
    b.migrate('source.db', 'retry.db', { executor: 'test', failAfterArchive: 1 }),
    /Injected/
  )
  const report = await b.migrate('source.db', 'retry.db', { executor: 'test' })
  assert.equal(report.status, 'applied')
  const db = new DatabaseSync(path.join(b.root, 'retry.db'))
  assert.throws(() => db.exec("UPDATE legacy_records SET raw_json='{}'"), /immutable/)
  assert.throws(() => db.exec('INSERT INTO legacy_records SELECT * FROM legacy_records'), /sealed/)
  db.close()
  await b.createTarget('changed.db')
  const changed = new DatabaseSync(path.join(b.root, 'changed.db'))
  changed.exec('CREATE TABLE unexpected (id INTEGER)')
  changed.close()
  await assert.rejects(b.migrate('source.db', 'changed.db', { executor: 'test' }), /schema changed/)
  await b.createTarget('digest.db')
  const prior = new DatabaseSync(path.join(b.root, 'digest.db'))
  prior
    .prepare('INSERT INTO schema_migrations VALUES (?,?,?,?,?,?)')
    .run('003_v3_import', '0'.repeat(64), report.source_fingerprint, 1, 'test', '{}')
  prior.close()
  await assert.rejects(b.migrate('source.db', 'digest.db', { executor: 'test' }), /script differs/)
})

test('FIX-01 V3 FK and CHECK defects reject backup; V2 historical defects remain explicit', async (t) => {
  const b = setup(t)
  const legacy = await b.createSource('legacy.db', fixture())
  assert.equal(legacy.backup.lineage, 'v2')
  assert(legacy.backup.historicalAnomalies.foreignKeys.length > 0)
  await b.createTarget('v3.db')
  const db = new DatabaseSync(path.join(b.root, 'v3.db'))
  db.exec(
    "PRAGMA foreign_keys=OFF; INSERT INTO feedback(interview_id,reviewer_name,recorded_by_user_id,recommendation,reason,submitted_at) VALUES (999,'test',999,'recommend','test',1)"
  )
  db.close()
  await assert.rejects(b.backup('v3.db', 'bad-backup.db'), /integrity/)
  assert(!fs.existsSync(path.join(b.root, 'bad-backup.db')))
  await b.createTarget('check.db')
  const invalid = new DatabaseSync(path.join(b.root, 'check.db'))
  invalid.exec(
    "PRAGMA ignore_check_constraints=ON; INSERT INTO positions(title,department,location,status,publish_date,description) VALUES ('test','','','invalid','','')"
  )
  invalid.close()
  await assert.rejects(b.backup('check.db', 'check-backup.db'), /integrity/)
})

test('FIX-01 valid SQLite replacement at the same inode cannot restore; intact backups can', async (t) => {
  const b = setup(t)
  await b.createTarget('v3.db')
  await b.backup('v3.db', 'backup.db')
  await b.restore('backup.db', 'good.db')
  const file = path.join(b.root, 'backup.db'),
    ino = fs.statSync(file).ino
  const replacement = new DatabaseSync(':memory:')
  replacement.exec('CREATE TABLE replacement(id INTEGER)')
  const { backup } = await import('node:sqlite')
  await backup(replacement, file)
  replacement.close()
  assert.equal(fs.statSync(file).ino, ino)
  await assert.rejects(b.restore('backup.db', 'rejected.db'), /fingerprint/)
  assert(!fs.existsSync(path.join(b.root, 'rejected.db')))
  assert.equal((await b.inspect('good.db')).counts.positions, 0)
  await assert.rejects(b.restore('backup.db', 'good.db'), /fingerprint|already exists/)
})

test('FIX-01 repeat import checks position content, missing rows and FK consistency', async (t) => {
  const b = setup(t)
  await b.createSource('source.db', fixture())
  for (const name of ['title.db', 'missing.db', 'fk.db']) {
    await b.createTarget(name)
    await b.migrate('source.db', name, { executor: 'test' })
    assert.equal(
      (await b.migrate('source.db', name, { executor: 'test' })).status,
      'already_applied'
    )
    const db = new DatabaseSync(path.join(b.root, name))
    db.exec('PRAGMA foreign_keys=OFF')
    if (name === 'title.db') db.exec("UPDATE positions SET title='Changed' WHERE id=1")
    if (name === 'missing.db') db.exec('DELETE FROM positions WHERE id=1')
    if (name === 'fk.db')
      db.exec(
        "INSERT INTO feedback(interview_id,reviewer_name,recorded_by_user_id,recommendation,reason,submitted_at) VALUES (999,'test',999,'recommend','test',1)"
      )
    db.close()
    await assert.rejects(
      b.migrate('source.db', name, { executor: 'test' }),
      /fingerprint|integrity/
    )
  }
})
