import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import dotenv from 'dotenv'
import { registerHooks } from 'node:module'

test('fresh imports cannot open a database, seed, load dotenv, listen or mutate files', async (t) => {
  let sqliteIntercepted = false
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (url === 'node:sqlite') {
        sqliteIntercepted = true
        return {
          format: 'module',
          shortCircuit: true,
          source:
            "export class DatabaseSync { constructor() { throw new Error('Unexpected database connection') } }"
        }
      }
      return nextLoad(url, context)
    }
  })
  t.after(() => hooks.deregister())
  t.mock.method(dotenv, 'config', () => {
    throw new Error('Unexpected dotenv read')
  })
  t.mock.method(http.Server.prototype, 'listen', () => {
    throw new Error('Unexpected listener')
  })
  for (const name of ['mkdirSync', 'writeFileSync', 'rmSync', 'unlinkSync']) {
    t.mock.method(fs, name, () => {
      throw new Error('Unexpected filesystem mutation: ' + name)
    })
  }
  const read = fs.readFileSync.bind(fs)
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (/\.env(?:\.|$)|\.db(?:-|$)|seed-data\.json/.test(String(file)))
      throw new Error('Unexpected data/config read')
    return read(file, ...args)
  })
  for (const file of [
    'index.js',
    'app.js',
    'config.js',
    'db/database.js',
    'db/schema.js',
    'db/schema-v3.js',
    'db/migration-sandbox.js',
    'services/command-core.js',
    'services/recruiting-auth.js',
    'services/recruiting-service.js',
    'services/interview-service.js',
    'db/seed.js',
    'utils/jwt.js',
    'middleware/auth.js',
    'routes/auth.js',
    'routes/profile.js',
    'routes/positions.js',
    'routes/candidates.js',
    'routes/interviews.js',
    'scripts/reset-db.js'
  ])
    await import(new URL('../server/' + file, import.meta.url))
  assert.equal(sqliteIntercepted, true)
})
