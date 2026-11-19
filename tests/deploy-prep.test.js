import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { snapshotDatabase } from '../deploy/v3/backup-core.mjs'
import { backupV2 } from '../deploy/v3/backup-v2.mjs'
import { check } from '../deploy/v3/preflight.mjs'
test('deployment backup defaults to plan and explicit gate refuses incomplete authorization', async () => {
  assert.deepEqual(await backupV2({}), { mode: 'plan-only', writes: false })
  await assert.rejects(
    backupV2({
      execute: true,
      source: '/var/lib/hireflow/hireflow.db',
      destination: '/tmp/unsafe.db'
    })
  )
})
test('fictional active WAL database online backup reopens and matches data; cannot overwrite', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-prep-')),
    source = path.join(root, 'source.db'),
    destination = path.join(root, 'backup.db')
  const db = new DatabaseSync(source)
  db.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT);INSERT INTO sample(value) VALUES ('fictional only')"
  )
  try {
    const result = await snapshotDatabase(source, destination)
    assert.equal(result.verified, true)
    const restored = new DatabaseSync(destination, { readOnly: true })
    assert.equal(restored.prepare('SELECT value FROM sample').get().value, 'fictional only')
    restored.close()
    await assert.rejects(snapshotDatabase(source, destination))
    assert.equal(db.prepare('SELECT count(*) n FROM sample').get().n, 1)
    await assert.rejects(
      backupV2({
        source,
        destination: path.join(root, '..', 'escape.db'),
        sandboxRoot: root,
        execute: true,
        authorization: 'DEC-LOCAL-FICTIONAL-TEST'
      })
    )
  } finally {
    db.close()
  }
})
test('deployment preflight checks isolation and placeholders without opening a database', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX production path gate requires Linux')
    return
  } // Reviewed production POSIX paths are intentionally not Windows paths.
  const env = {
    NODE_ENV: 'production',
    V3_EXPECTED_SHA: 'a'.repeat(40),
    V3_RELEASE_DIR: '/srv/hireflow-v3/releases/' + 'a'.repeat(40),
    V3_DATA_ROOT: '/var/lib/hireflow-v3',
    V3_DATABASE_PATH: '/var/lib/hireflow-v3/fresh.db',
    V3_PORT: '3301',
    V3_JWT_SECRET: 'x'.repeat(40)
  }
  // Actual production service-user/filesystem gate requires a prepared Linux instance.
  assert.throws(() => check(env))
  assert.throws(() => check({ ...env, V3_DATABASE_PATH: '/var/lib/hireflow/hireflow.db' }))
})

test('PM2 template parses as single fork, dedicated interpreter, bounded stop; no default secret', async () => {
  const { createRequire } = await import('node:module'),
    require = createRequire(import.meta.url),
    p = require.resolve('../deploy/v3/ecosystem.config.cjs')
  const old = {
    V3_RELEASE_DIR: process.env.V3_RELEASE_DIR,
    V3_JWT_SECRET: process.env.V3_JWT_SECRET
  }
  try {
    process.env.V3_RELEASE_DIR = process.cwd()
    process.env.V3_JWT_SECRET = 'fictional-template-test-only'
    delete require.cache[p]
    const config = require(p)
    assert.equal(config.apps[0].instances, 1)
    assert.equal(config.apps[0].exec_mode, 'fork')
    assert.equal(config.apps[0].interpreter, '/usr/bin/node')
    assert.equal(config.apps[0].kill_timeout, 15000)
    delete process.env.V3_JWT_SECRET
    delete require.cache[p]
    assert.throws(() => require(p))
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    delete require.cache[p]
  }
})
import { createSchema } from '../server/db/schema.js'
import { releasePath, gitIdentity, noLinks } from '../deploy/v3/release-identity.mjs'
import { validateManifest, evidenceFile, rollbackPlan } from '../deploy/v3/rollback-plan.mjs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
test('pure POSIX release path rejects escape, siblings, V2, missing approval and noncanonical forms', () => {
  const sha = 'a'.repeat(40),
    valid = '/srv/hireflow-v3/releases/' + sha
  assert.equal(releasePath(valid, sha), valid)
  for (const dir of [
    valid + '/',
    '/srv/hireflow-v3/releases/../' + sha,
    '/srv/hireflow-v3/releases-evil/' + sha,
    '/srv/hireflow/' + sha,
    '/srv/hireflow-v3/releases//' + sha
  ])
    assert.throws(() => releasePath(dir, sha))
  assert.throws(() => releasePath(valid))
  assert.throws(() => releasePath(valid, 'b'.repeat(40)))
})
test('actual Git version and clean-tree checks reject tamper, wrong SHA and linked directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-git-'))
  fs.writeFileSync(path.join(dir, 'safe.txt'), 'fictional')
  const git = (...args) =>
    execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  git('init')
  git('add', 'safe.txt')
  git(
    '-c',
    'user.name=Fictional',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture'
  )
  const sha = git('rev-parse', 'HEAD')
  assert.equal(gitIdentity(dir, sha).sha, sha)
  assert.throws(() => gitIdentity(dir, 'b'.repeat(40)))
  fs.writeFileSync(path.join(dir, 'safe.txt'), 'changed')
  assert.throws(() => gitIdentity(dir, sha))
  const link = dir + '-link'
  fs.symlinkSync(dir, link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => noLinks(link))
})
test('production backup entry rejects sandboxRoot; generic engine handles active V2 WAL concurrent write and stable WITHOUT ROWID/blob/bigint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-wal-')),
    source = path.join(root, 'fictional.db'),
    destination = path.join(root, 'snapshot.db')
  const db = new DatabaseSync(source)
  try {
    createSchema(db)
    db.exec(
      "PRAGMA journal_mode=WAL;CREATE TABLE odd(rowid TEXT, id INTEGER PRIMARY KEY, value BLOB);INSERT INTO odd VALUES ('shadow',9223372036854775807,x'00ff');CREATE TABLE keyed(k TEXT PRIMARY KEY,v TEXT) WITHOUT ROWID;INSERT INTO keyed VALUES('x','before')"
    )
    await assert.rejects(
      backupV2({
        source,
        destination,
        sandboxRoot: root,
        execute: true,
        authorization: 'DEC-FICTIONAL'
      })
    )
    const before = db.prepare('SELECT count(*) n FROM positions').get().n
    const pending = snapshotDatabase(source, destination)
    db.prepare(
      'INSERT INTO positions(title,department,location,status,publish_date,description) VALUES (?,?,?,?,?,?)'
    ).run('虚构并发职位', '测试', '上海', 'open', '2026-11-16', '虚构')
    const result = await pending
    assert.equal(result.verified, true)
    assert.equal(result.sourceIndependentImmutabilityProof, false)
    const copied = new DatabaseSync(destination, { readOnly: true })
    try {
      assert.equal(copied.prepare('SELECT count(*) n FROM positions').get().n, before)
      assert.equal(copied.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      assert.deepEqual(copied.prepare('PRAGMA foreign_key_check').all(), [])
    } finally {
      copied.close()
    }
    assert.equal(db.prepare('SELECT count(*) n FROM positions').get().n, before + 1)
    const again = await snapshotDatabase(source, path.join(root, 'second.db'))
    assert.notEqual(again.fingerprint, result.fingerprint)
  } finally {
    db.close()
  }
})
test('backup failure preserves existing target and source, FK violations and target symlinks refused', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-bad-')),
    source = path.join(root, 'source.db'),
    dest = path.join(root, 'exists.db'),
    db = new DatabaseSync(source)
  try {
    db.exec(
      'PRAGMA foreign_keys=OFF;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE child(pid INTEGER REFERENCES parent(id));INSERT INTO child VALUES(99)'
    )
    fs.writeFileSync(dest, 'retain')
    await assert.rejects(snapshotDatabase(source, dest))
    assert.equal(fs.readFileSync(dest, 'utf8'), 'retain')
    assert.equal(db.prepare('SELECT count(*) n FROM child').get().n, 1)
    await assert.rejects(snapshotDatabase(source, path.join(root, 'missing', 'target.db')))
    db.exec('DELETE FROM child')
    const dir = path.join(root, 'target.db')
    fs.mkdirSync(dir)
    await assert.rejects(snapshotDatabase(source, dir))
  } finally {
    db.close()
  }
})
const manifest = () => ({
  authorization: 'DEC-ROLLBACK-APPROVED',
  v2Sha: 'a'.repeat(40),
  renderDeployId: 'dep-abcdefghij1234',
  v2Database: '/var/lib/hireflow/hireflow.db',
  nginxSnapshot: { path: '/var/backups/hireflow-deploy/rollback/v2.conf', sha256: 'b'.repeat(64) },
  renderEvidence: {
    path: '/var/backups/hireflow-deploy/rollback/render.json',
    sha256: 'c'.repeat(64)
  }
})
test('rollback placeholders, invalid deploy ids, SHA and unsafe evidence paths are refused; format is not live proof', () => {
  const m = manifest()
  assert.deepEqual(validateManifest(m), { formatValidated: true, resourcesVerified: false })
  for (const patch of [
    { authorization: 'DEC-REPLACE' },
    { renderDeployId: 'x' },
    { v2Sha: 'short' },
    {
      nginxSnapshot: {
        path: '/var/backups/hireflow-deploy/rollback/../x.conf',
        sha256: 'b'.repeat(64)
      }
    }
  ])
    assert.throws(() => validateManifest({ ...m, ...patch }))
  assert.throws(() => rollbackPlan(m)) // Real approved resources are absent; must not claim readiness.
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hf-evidence-')), 'snapshot.conf')
  fs.writeFileSync(p, 'fictional config')
  const h = createHash('sha256').update('fictional config').digest('hex')
  assert.equal(evidenceFile(p, h).toString(), 'fictional config')
  assert.throws(() => evidenceFile(p, 'a'.repeat(64)))
})

test('CLI rejects sandbox, unexpected values and duplicate options before any execution', async () => {
  const { spawnSync } = await import('node:child_process')
  for (const args of [
    ['--sandbox-root', '/tmp/x'],
    ['--execute', 'false'],
    ['--source', 'x', '--source', 'y']
  ])
    assert.equal(
      spawnSync(process.execPath, ['deploy/v3/backup-v2.mjs', ...args], { encoding: 'utf8' })
        .status,
      1
    )
})
test('backup target symlink refused without changing referent (if OS permits creating test links)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-link-')),
    source = path.join(dir, 'source.db'),
    real = path.join(dir, 'retain.db'),
    link = path.join(dir, 'target.db')
  const db = new DatabaseSync(source)
  db.exec('CREATE TABLE x(id INTEGER)')
  db.close()
  fs.writeFileSync(real, 'keep')
  try {
    fs.symlinkSync(real, link, 'file')
  } catch (e) {
    if (['EPERM', 'EACCES'].includes(e.code)) {
      t.skip('Windows file symlink privilege absent')
      return
    }
    throw e
  }
  await assert.rejects(snapshotDatabase(source, link))
  assert.equal(fs.readFileSync(real, 'utf8'), 'keep')
})
