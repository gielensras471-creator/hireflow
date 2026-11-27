import { createHash } from 'node:crypto'
import { authSchemaFingerprint } from './v3-auth-migration.js'
export const schemaFingerprint = 'af1212fbfa27d78f852b9ea827f536d7f9b2eae10a53cceb63cb0abcfe886bfe'
export const verifyV3Structure = (db) => {
  const incompatible = () => new TypeError('Incompatible V3 database structure or safety settings')
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
  const fingerprint = createHash('sha256').update(JSON.stringify(schema)).digest('hex')
  if (![schemaFingerprint, authSchemaFingerprint].includes(fingerprint)) throw incompatible()
  const integrity = db.prepare('PRAGMA main.integrity_check').all()
  if (
    integrity.length !== 1 ||
    integrity[0].integrity_check !== 'ok' ||
    db.prepare('PRAGMA main.foreign_key_check').get()
  )
    throw incompatible()
  return fingerprint
}
