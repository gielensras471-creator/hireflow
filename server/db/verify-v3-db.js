import { createHash } from 'node:crypto'
import { isInMemoryConnection } from './database.js'

// Fingerprint the persisted DDL of DEV-02, including constraints, indexes and triggers.
const schemaFingerprint = 'af1212fbfa27d78f852b9ea827f536d7f9b2eae10a53cceb63cb0abcfe886bfe'
const incompatible = () => new TypeError('A prepared, isolated V3 in-memory database is required')

export const verifyV3Database = (db) => {
  if (!isInMemoryConnection(db) || !db.isOpen || db.isTransaction) throw incompatible()
  const databases = db.prepare('PRAGMA database_list').all()
  if (
    !databases.some(({ name }) => name === 'main') ||
    databases.some(({ name, file }) => !['main', 'temp'].includes(name) || file !== '') ||
    db.prepare('PRAGMA main.journal_mode').get().journal_mode !== 'memory' ||
    db.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get()
  )
    throw incompatible()

  for (const [pragma, expected] of [
    ['foreign_keys', 1],
    ['recursive_triggers', 1],
    ['ignore_check_constraints', 0],
    ['writable_schema', 0],
    ['query_only', 0]
  ]) {
    if (db.prepare('PRAGMA ' + pragma).get()[pragma] !== expected) throw incompatible()
  }
  const schema = db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name'
    )
    .all()
    .map((row) => ({ ...row, sql: row.sql.replace(/\r\n/g, '\n') }))
  if (createHash('sha256').update(JSON.stringify(schema)).digest('hex') !== schemaFingerprint)
    throw incompatible()
  const integrity = db.prepare('PRAGMA main.integrity_check').all()
  if (
    integrity.length !== 1 ||
    integrity[0].integrity_check !== 'ok' ||
    db.prepare('PRAGMA main.foreign_key_check').get()
  )
    throw incompatible()
}
