import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash } from 'node:crypto'
const hash = (db) => {
  const schema = db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name'
    )
    .all()
  const encode = (v) =>
    JSON.stringify(v, (_k, x) =>
      typeof x === 'bigint'
        ? { bigint: x.toString() }
        : x instanceof Uint8Array
          ? { blob: Buffer.from(x).toString('hex') }
          : x
    )
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  return createHash('sha256')
    .update(
      encode([
        schema,
        tables.map(({ name }) => [
          name,
          (() => {
            const stmt = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
            stmt.setReadBigInts(true)
            return stmt.all()
          })()
            .map(encode)
            .sort()
        ])
      ])
    )
    .digest('hex')
}
function plain(file, exists) {
  if (!path.isAbsolute(file)) throw Error('Absolute path required')
  const parent = path.dirname(file)
  if (fs.realpathSync(parent) !== parent) throw Error('Linked parent refused')
  if (exists) {
    const s = fs.lstatSync(file)
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || fs.realpathSync(file) !== file)
      throw Error('Unsafe file')
  }
}
const exists = (p) => {
  try {
    fs.lstatSync(p)
    return true
  } catch (e) {
    if (e.code === 'ENOENT') return false
    throw e
  }
}
export async function snapshotDatabase(source, destination) {
  plain(source, true)
  plain(destination, false)
  if (source === destination) throw Error('Never overwrite source')
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (exists(destination + suffix)) throw Error('Target sidecar exists')
    if (exists(source + suffix)) plain(source + suffix, true)
  }
  const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 })
  try {
    db.exec('PRAGMA foreign_keys=ON;BEGIN DEFERRED')
    if (
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').get()
    )
      throw Error('Source integrity refused')
    const before = hash(db)
    fs.closeSync(fs.openSync(destination, 'wx', 0o600))
    const reserved = fs.statSync(destination)
    await backup(db, destination)
    const after = fs.lstatSync(destination)
    if (after.dev !== reserved.dev || after.ino !== reserved.ino)
      throw Error('Target identity changed')
    plain(destination, true)
    const restored = new DatabaseSync(destination, { readOnly: true })
    try {
      if (
        restored.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
        restored.prepare('PRAGMA foreign_key_check').get() ||
        hash(restored) !== before
      )
        throw Error('Backup verification failed')
    } finally {
      restored.close()
    }
    db.exec('COMMIT')
    return {
      mode: 'executed',
      verified: true,
      fingerprint: before,
      sourceConnectionReadOnly: true,
      sourceIndependentImmutabilityProof: false
    }
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
  }
}
