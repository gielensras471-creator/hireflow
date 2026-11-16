// Never runs on import; no default write. Uses SQLite online backup, not fs.copyFile.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash } from 'node:crypto'
const hash = (db) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        db
          .prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name")
          .all()
          .map(({ name, sql }) => [
            name,
            sql,
            db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()
          ])
      )
    )
    .digest('hex')
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
export async function backupV2({
  source,
  destination,
  authorization,
  execute = false,
  sandboxRoot
}) {
  if (!execute) return { mode: 'plan-only', writes: false }
  if (!/^DEC-[A-Z0-9-]+$/.test(authorization ?? '')) throw Error('Explicit Owner decision required')
  if (sandboxRoot) {
    const root = fs.realpathSync(sandboxRoot)
    if (
      root === path.parse(root).root ||
      root.startsWith('/var/lib') ||
      root.startsWith('/var/backups')
    )
      throw Error('Not a sandbox')
    if (path.dirname(source) !== root || path.dirname(destination) !== root)
      throw Error('Sandbox path escape')
  } else if (
    process.platform !== 'linux' ||
    source !== '/var/lib/hireflow/hireflow.db' ||
    path.dirname(destination) !== '/var/backups/hireflow-v2'
  )
    throw Error('Unreviewed production target')
  plain(source, true)
  plain(destination, false)
  if (source === destination) throw Error('Never overwrite source')
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.existsSync(destination + suffix)) throw Error('Target sidecar exists')
    if (fs.existsSync(source + suffix)) plain(source + suffix, true)
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
    await backup(db, destination)
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
      sourceUnchanged: true,
      authorization
    }
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2),
      get = (k) => {
        const i = args.indexOf(k)
        return i < 0 ? undefined : args[i + 1]
      }
    console.log(
      JSON.stringify(
        await backupV2({
          source: get('--source'),
          destination: get('--destination'),
          authorization: get('--authorization'),
          execute: args.includes('--execute'),
          sandboxRoot: get('--sandbox-root')
        })
      )
    )
  } catch {
    console.error(
      'V2 backup refused; source retained, inspect any new target without overwriting it'
    )
    process.exitCode = 1
  }
}
