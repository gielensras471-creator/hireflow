import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
    const result = await backupV2({
      source,
      destination,
      sandboxRoot: root,
      execute: true,
      authorization: 'DEC-LOCAL-FICTIONAL-TEST'
    })
    assert.equal(result.verified, true)
    const restored = new DatabaseSync(destination, { readOnly: true })
    assert.equal(restored.prepare('SELECT value FROM sample').get().value, 'fictional only')
    restored.close()
    await assert.rejects(
      backupV2({
        source,
        destination,
        sandboxRoot: root,
        execute: true,
        authorization: 'DEC-LOCAL-FICTIONAL-TEST'
      })
    )
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
    V3_RELEASE_DIR: '/srv/hireflow-v3/releases/test',
    V3_DATA_ROOT: '/var/lib/hireflow-v3',
    V3_DATABASE_PATH: '/var/lib/hireflow-v3/fresh.db',
    V3_PORT: '3301',
    V3_JWT_SECRET: 'x'.repeat(40)
  }
  assert.equal(check(env).databaseOpened, false)
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
