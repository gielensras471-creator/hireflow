import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync, backup, constants } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import { openDatabase } from './database.js'
import { createV3Schema } from './schema-v3.js'
import { schemaFingerprint, verifyV3Structure } from './v3-database-checks.js'
import {
  addV3AuthVersion,
  authMigrationHash,
  authMigrationVersion,
  authSchemaFingerprint
} from './v3-auth-migration.js'
const connections = new WeakMap(),
  localDrives = new Set()
const version = 'v3_file_001'
const scriptHash = createHash('sha256')
  .update(
    fs.readFileSync(new URL('./schema-v3.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  )
  .digest('hex')
const fail = () => {
  throw new Error('V3 file path, identity or version is not authorized')
}
export function resolveV3File(dataRoot, databasePath, existing = true) {
  if (
    typeof dataRoot !== 'string' ||
    typeof databasePath !== 'string' ||
    !path.isAbsolute(dataRoot) ||
    !path.isAbsolute(databasePath) ||
    /^[/\\]{2}/.test(dataRoot) ||
    /^[/\\]{2}/.test(databasePath)
  )
    fail()
  const root = path.resolve(dataRoot),
    file = path.resolve(databasePath)
  if (path.dirname(file) !== root || !/^[-a-zA-Z0-9_]+\.db$/.test(path.basename(file))) fail()
  let part = path.parse(root).root
  for (const name of root.slice(part.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, name)
    if (fs.lstatSync(part).isSymbolicLink()) fail()
  }
  if (fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) fail()
  if (process.platform === 'win32') {
    const drive = path.parse(root).root.slice(0, 1)
    if (!/^[A-Za-z]$/.test(drive)) fail()
    if (!localDrives.has(drive)) {
      try {
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "$d=Get-Volume -DriveLetter $env:HF_VOLUME_CHECK -ErrorAction Stop; if($d.DriveType -ne 'Fixed'){exit 1}"
          ],
          {
            env: { ...process.env, HF_VOLUME_CHECK: drive },
            stdio: 'ignore',
            windowsHide: true,
            timeout: 10000
          }
        )
      } catch {
        fail()
      }
      localDrives.add(drive)
    }
  } else {
    const owner = fs.statSync(root)
    if (owner.uid !== process.getuid() || (owner.mode & 0o022) !== 0) fail()
    const type = fs.statfsSync(root).type
    if ([0x6969, 0x517b, 0xff534d42, 0xfe534d42].includes(type)) fail()
  }
  if (existing) {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || fs.realpathSync(file) !== file)
      fail()
    if (process.platform !== 'win32' && (st.uid !== process.getuid() || (st.mode & 0o077) !== 0))
      fail()
  }
  for (const suffix of ['-wal', '-shm', '-journal'])
    if (fs.existsSync(file + suffix)) {
      if (!existing) fail()
      const st = fs.lstatSync(file + suffix)
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) fail()
    }
  return file
}
const identity = (file) => {
  const s = fs.statSync(file)
  return { dev: s.dev, ino: s.ino }
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino
function versionCheck(db, fingerprint) {
  const rows = db.prepare('SELECT * FROM schema_migrations ORDER BY version DESC').all()
  const base = rows.find((row) => row.version === version)
  const auth = rows.find((row) => row.version === authMigrationVersion)
  if (!base || base.script_sha256 !== scriptHash || rows.length !== (auth ? 2 : 1)) fail()
  const report = JSON.parse(base.report_json)
  if (
    report.kind !== 'fresh_v3_initialization' ||
    report.schemaFingerprint !== schemaFingerprint ||
    typeof report.databaseId !== 'string' ||
    base.source_fingerprint !== 'fresh:' + report.databaseId
  )
    fail()
  if (auth) {
    const migrated = JSON.parse(auth.report_json)
    if (
      fingerprint !== authSchemaFingerprint ||
      auth.script_sha256 !== authMigrationHash ||
      auth.source_fingerprint !== base.source_fingerprint ||
      migrated.kind !== 'auth_version' ||
      migrated.schemaFingerprint !== fingerprint
    )
      fail()
  } else if (fingerprint !== schemaFingerprint) fail()
  return base.source_fingerprint
}
function auditRelations(db) {
  if (
    db
      .prepare(
        "SELECT 1 FROM business_events e LEFT JOIN command_receipts r ON r.command_id=e.command_id WHERE r.command_id IS NULL OR r.actor_user_id IS NOT e.actor_user_id OR json_extract(r.result_json,'$.version') IS NOT e.aggregate_version LIMIT 1"
      )
      .get() ||
    db
      .prepare(
        'SELECT 1 FROM command_receipts r LEFT JOIN business_events e ON e.command_id=r.command_id WHERE e.id IS NULL LIMIT 1'
      )
      .get() ||
    db
      .prepare(
        'SELECT command_id FROM business_events GROUP BY command_id HAVING count(*)<>1 LIMIT 1'
      )
      .get()
  )
    throw new Error('V3 audit linkage verification failed')
}
export function verifyPersistentV3Connection(db) {
  const cap = connections.get(db)
  if (!cap || !db.isOpen || db.isTransaction) fail()
  const file = resolveV3File(cap.root, cap.file)
  if (!same(identity(file), cap.identity)) fail()
  const databases = db.prepare('PRAGMA database_list').all()
  if (
    !databases.some((r) => r.name === 'main' && path.resolve(r.file) === file) ||
    databases.some((r) => !['main', 'temp'].includes(r.name)) ||
    db.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get()
  )
    fail()
  if (
    db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' ||
    db.prepare('PRAGMA synchronous').get().synchronous !== 2 ||
    db.prepare('PRAGMA busy_timeout').get().timeout !== 5000
  )
    fail()
  const fingerprint = verifyV3Structure(db)
  versionCheck(db, fingerprint)
  auditRelations(db)
  return fingerprint
}
function connect(root, file, readOnly = false) {
  file = resolveV3File(root, file)
  const before = identity(file),
    db = new DatabaseSync(file, { readOnly, timeout: 5000 })
  try {
    db.exec(
      'PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000'
    )
    connections.set(db, { root: path.resolve(root), file, identity: before })
    verifyPersistentV3Connection(db)
    db.setAuthorizer((action, name, value) => {
      if ([constants.SQLITE_ATTACH, constants.SQLITE_DETACH].includes(action))
        return constants.SQLITE_DENY
      if (
        action === constants.SQLITE_PRAGMA &&
        value !== null &&
        [
          'foreign_keys',
          'recursive_triggers',
          'ignore_check_constraints',
          'writable_schema',
          'query_only',
          'journal_mode',
          'synchronous',
          'busy_timeout'
        ].includes(name?.toLowerCase())
      )
        return constants.SQLITE_DENY
      return constants.SQLITE_OK
    })
    return db
  } catch (e) {
    connections.delete(db)
    db.close()
    throw e
  }
}
export const openPersistentV3 = (root, file) => connect(root, file)

function upgradeAuthVersion(db, executor) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const current = verifyV3Structure(db)
    const source = versionCheck(db, current)
    if (current === authSchemaFingerprint) {
      db.exec('COMMIT')
      return { status: 'already-current' }
    }
    addV3AuthVersion(db)
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?,?,?)').run(
      authMigrationVersion,
      authMigrationHash,
      source,
      Date.now(),
      executor,
      JSON.stringify({ kind: 'auth_version', schemaFingerprint: authSchemaFingerprint })
    )
    const fingerprint = verifyV3Structure(db)
    versionCheck(db, fingerprint)
    auditRelations(db)
    db.exec('COMMIT')
    return { status: 'upgraded' }
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw new Error('V3 auth migration refused; changes rolled back', { cause: error })
  }
}

export function migratePersistentV3Auth(root, file, executor) {
  if (typeof executor !== 'string' || !executor.trim())
    throw new Error('Explicit migration identity required')
  const db = openPersistentV3(root, file)
  try {
    return upgradeAuthVersion(db, executor.trim())
  } finally {
    db.close()
  }
}
const digest = (db) => {
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  return createHash('sha256')
    .update(
      JSON.stringify(
        tables.map(({ name }) => [
          name,
          db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()
        ])
      )
    )
    .digest('hex')
}
async function snapshot(db, root, destination) {
  destination = resolveV3File(root, destination, false)
  const fd = fs.openSync(destination, 'wx', 0o600)
  fs.closeSync(fd)
  const reserved = identity(destination)
  try {
    await backup(db, destination)
    if (!same(identity(destination), reserved)) fail()
    const configured = new DatabaseSync(destination)
    try {
      configured.exec('PRAGMA journal_mode=WAL')
    } finally {
      configured.close()
    }
    const reopened = connect(root, destination, true)
    try {
      return {
        file: path.basename(destination),
        fingerprint: digest(reopened),
        schemaFingerprint: verifyPersistentV3Connection(reopened),
        integrity: 'ok',
        reopened: true
      }
    } finally {
      reopened.close()
    }
  } catch (e) {
    // Do not delete or overwrite an unverified target; leave this newly reserved file for diagnosis.
    throw new Error('V3 snapshot failed; source unchanged and target retained for inspection', {
      cause: e
    })
  }
}
export async function initializeV3File(root, destination, executor) {
  if (typeof executor !== 'string' || !executor.trim())
    throw new Error('Explicit initializer identity required')
  resolveV3File(root, destination, false)
  const db = openDatabase(':memory:')
  try {
    createV3Schema(db)
    const databaseId = randomUUID()
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?,?,?)').run(
      version,
      scriptHash,
      'fresh:' + databaseId,
      Date.now(),
      executor,
      JSON.stringify({ kind: 'fresh_v3_initialization', schemaFingerprint, databaseId })
    )
    upgradeAuthVersion(db, executor)
    const result = await snapshot(db, root, destination)
    // Open the published file through the same production gate, not a special test exemption.
    const reopened = openPersistentV3(root, destination)
    reopened.close()
    return result
  } finally {
    db.close()
  }
}
export function initializeFirstHr(root, file, { username, name, password, role = 'hr' } = {}) {
  if (
    typeof username !== 'string' ||
    !username.trim() ||
    username.length > 128 ||
    typeof name !== 'string' ||
    !name.trim() ||
    !['hr', '招聘管理员'].includes(role) ||
    typeof password !== 'string' ||
    Buffer.byteLength(password) < 12 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error('Invalid initial HR credentials')
  const db = openPersistentV3(root, file)
  try {
    db.exec('BEGIN IMMEDIATE')
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get())
      throw new Error('Initial HR already provisioned')
    db.prepare(
      'INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
    ).run(username, bcrypt.hashSync(password, 12), name, role, '', '', '')
    db.exec('COMMIT')
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw e
  } finally {
    db.close()
  }
}
export async function backupV3File(root, source, destination) {
  const db = connect(root, source, true)
  try {
    db.exec('BEGIN DEFERRED')
    const before = digest(db),
      result = await snapshot(db, root, destination)
    if (result.fingerprint !== before) throw new Error('Snapshot content mismatch')
    db.exec('COMMIT')
    return result
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK')
    db.close()
  }
}
export const restoreV3File = (root, source, destination) => backupV3File(root, source, destination)
