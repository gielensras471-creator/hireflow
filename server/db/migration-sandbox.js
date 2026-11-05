import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as sqlite from 'node:sqlite'
import { createSchema } from './schema.js'
import { createV3Schema } from './schema-v3.js'

const version = '003_v3_import'
const tables = ['positions', 'candidates', 'interviews']
const digest = (value) => createHash('sha256').update(value).digest('hex')
const json = (value) => JSON.stringify(value)
const scriptHash = () =>
  digest(
    [
      import.meta.url,
      new URL('./schema-v3.js', import.meta.url),
      new URL('./schema.js', import.meta.url)
    ]
      .map((p) => fs.readFileSync(new URL(p)))
      .map((b) => b.toString())
      .join('\n')
  )
const dateValid = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value
const readRows = (db, table) =>
  db
    .prepare('SELECT * FROM ' + table + ' ORDER BY id')
    .all()
    .map((row) =>
      Object.fromEntries(
        Object.keys(row)
          .sort()
          .map((k) => [k, row[k]])
      )
    )
const check = (db) => {
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all()
  const integrity = db
    .prepare('PRAGMA integrity_check')
    .all()
    .map((r) => r.integrity_check)
  return { foreignKeys, integrity }
}
const inventory = (db) => {
  const names = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((r) => r.name)
  return Object.fromEntries(
    names.map((name) => [
      name,
      db.prepare('SELECT COUNT(*) n FROM "' + name.replaceAll('"', '""') + '"').get().n
    ])
  )
}

const schemaFingerprint = (db) =>
  digest(
    json(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all())
  )

const logicalFingerprint = (db) => {
  const schema = db
    .prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')
    .all()
  const rows = Object.fromEntries(
    schema
      .filter((r) => r.type === 'table')
      .map((r) => [
        r.name,
        db.prepare('SELECT * FROM "' + r.name.replaceAll('"', '""') + '" ORDER BY rowid').all()
      ])
  )
  return digest(json({ schema, rows }))
}

const migrationFingerprint = (db) =>
  digest(
    json({
      positions: readRows(db, 'positions'),
      legacy: db
        .prepare('SELECT * FROM legacy_records ORDER BY source_key,entity_type,legacy_id')
        .all()
    })
  )

// Capability is the closure, not a caller-provided directory or testOnly flag.
// No external database import/open API. Fixtures originate only from caller-supplied values.
export const createMigrationSandbox = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hireflow-migration-')))
  const rootStat = fs.statSync(root)
  const files = new Map()
  let backupSequence = 0
  let disposed = false,
    busy = false
  const validateRoot = () => {
    if (
      disposed ||
      fs.lstatSync(root).isSymbolicLink() ||
      fs.realpathSync(root) !== root ||
      fs.statSync(root).ino !== rootStat.ino
    )
      throw Error('Invalid owned sandbox')
  }
  const resolve = (name) => {
    validateRoot()
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+\.db$/.test(name))
      throw Error('Only direct sandbox .db names allowed')
    return path.join(root, name)
  }
  const validate = (name) => {
    const file = resolve(name),
      entry = files.get(name)
    if (!entry) throw Error('Unregistered sandbox file')
    const stat = fs.lstatSync(file)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.ino !== entry.ino ||
      stat.dev !== entry.dev ||
      fs.realpathSync(file) !== file
    )
      throw Error('Sandbox file replaced or linked')
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const side = file + suffix
      if (
        fs.existsSync(side) &&
        (fs.lstatSync(side).isSymbolicLink() ||
          !fs.lstatSync(side).isFile() ||
          fs.lstatSync(side).nlink !== 1)
      )
        throw Error('Unsafe SQLite sidecar')
    }
    return file
  }
  const reserve = (name, kind) => {
    const file = resolve(name)
    if (
      files.has(name) ||
      fs.existsSync(file) ||
      ['-wal', '-shm', '-journal'].some((s) => fs.existsSync(file + s))
    )
      throw Error('Target already exists')
    fs.closeSync(fs.openSync(file, 'wx', 0o600))
    const stat = fs.statSync(file)
    files.set(name, { ino: stat.ino, dev: stat.dev, kind })
    return file
  }
  const open = (name, readonly = false) => {
    const db = new sqlite.DatabaseSync(validate(name), { readOnly: readonly })
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON')
    if (
      db
        .prepare('PRAGMA database_list')
        .all()
        .some((r) => !['main', 'temp'].includes(r.name))
    ) {
      db.close()
      throw Error('Attached database forbidden')
    }
    return db
  }
  const exclusive = async (callback) => {
    if (busy) throw Error('Sandbox operation already running')
    validateRoot()
    busy = true
    try {
      return await callback()
    } finally {
      busy = false
    }
  }
  const verify = (db, lineage) => {
    const result = check(db)
    const strict = result.foreignKeys.length === 0 && json(result.integrity) === '["ok"]'
    if (
      !strict &&
      (lineage !== 'v2' ||
        result.integrity.some((v) => v !== 'ok' && !v.startsWith('CHECK constraint failed')))
    )
      throw Error('Snapshot integrity verification failed')
    return { ...result, lineage, historicalAnomalies: strict ? null : result }
  }
  const snapshot = async (db, name, kind, lineage = 'v3') => {
    const beforeCheck = verify(db, lineage),
      before = inventory(db),
      fingerprint = logicalFingerprint(db),
      schema = schemaFingerprint(db)
    const file = reserve(name, kind)
    let reopened
    try {
      await sqlite.backup(db, file)
      reopened = open(name)
      reopened.exec('PRAGMA query_only=ON')
      const verification = verify(reopened, lineage),
        counts = inventory(reopened)
      if (
        json(before) !== json(counts) ||
        logicalFingerprint(reopened) !== fingerprint ||
        schemaFingerprint(reopened) !== schema
      )
        throw Error('Snapshot verification failed')
      Object.assign(files.get(name), { schema, fingerprint, lineage })
      return {
        file: name,
        counts,
        ...verification,
        sourceCheck: beforeCheck,
        fingerprint,
        reopened: true
      }
    } catch (error) {
      if (reopened?.isOpen) reopened.close()
      reopened = undefined
      // Only this operation's newly reserved file may be removed, after identity validation.
      try {
        const owned = validate(name)
        for (const suffix of ['-wal', '-shm', '-journal', ''])
          if (fs.existsSync(owned + suffix)) fs.unlinkSync(owned + suffix)
        files.delete(name)
      } catch (cleanupError) {
        error.cleanupError = cleanupError.message
      }
      throw error
    } finally {
      if (reopened?.isOpen) reopened.close()
    }
  }
  return {
    root,
    createSource: (name, fixture) =>
      exclusive(async () => {
        reserve(name, 'source')
        files.get(name).lineage = 'v2'
        const db = open(name)
        try {
          createSchema(db)
          db.exec(
            'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON; BEGIN'
          )
          for (const table of tables)
            for (const row of fixture[table] || []) {
              const allowed = db
                .prepare('PRAGMA table_info(' + table + ')')
                .all()
                .map((r) => r.name)
              const keys = Object.keys(row)
              if (!keys.length || keys.some((k) => !allowed.includes(k)))
                throw Error('Unknown fixture fields')
              db.prepare(
                'INSERT INTO ' +
                  table +
                  ' (' +
                  keys.join(',') +
                  ') VALUES (' +
                  keys.map(() => '?').join(',') +
                  ')'
              ).run(...Object.values(row))
            }
          db.exec('COMMIT; PRAGMA ignore_check_constraints=OFF; PRAGMA foreign_keys=ON')
          // Backup while source WAL is still open and contains fixture writes.
          const walBytes = fs.statSync(validate(name) + '-wal').size
          const backup = await snapshot(
            db,
            name.replace('.db', '-initial-backup.db'),
            'backup',
            'v2'
          )
          return { file: name, walBytes, backup }
        } finally {
          db.close()
        }
      }),
    createTarget: (name) =>
      exclusive(async () => {
        const db = new sqlite.DatabaseSync(':memory:')
        try {
          createV3Schema(db)
          return await snapshot(db, name, 'target')
        } finally {
          db.close()
        }
      }),
    inspect: (name) =>
      exclusive(async () => {
        const db = open(name, true)
        try {
          return {
            counts: inventory(db),
            ...check(db),
            rows: Object.fromEntries(
              db
                .prepare(
                  "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
                .all()
                .map(({ name: table }) => [
                  table,
                  db.prepare('SELECT * FROM "' + table + '"').all()
                ])
            )
          }
        } finally {
          db.close()
        }
      }),
    backup: (name, destination) =>
      exclusive(async () => {
        const db = open(name)
        db.exec('PRAGMA query_only=ON')
        try {
          return await snapshot(db, destination, 'backup', files.get(name).lineage)
        } finally {
          db.close()
        }
      }),
    restore: (backupName, destination) =>
      exclusive(async () => {
        validate(backupName)
        if (files.get(backupName).kind !== 'backup')
          throw Error('Restore requires a registered backup')
        const db = open(backupName)
        db.exec('PRAGMA query_only=ON; BEGIN')
        try {
          const registered = files.get(backupName)
          verify(db, registered.lineage)
          if (
            schemaFingerprint(db) !== registered.schema ||
            logicalFingerprint(db) !== registered.fingerprint
          )
            throw Error('Backup content fingerprint mismatch')
          return await snapshot(db, destination, 'restored', registered.lineage)
        } finally {
          db.close()
        }
      }),
    migrate: (sourceName, targetName, { executor, expectedScriptSha256, failAfterArchive } = {}) =>
      exclusive(async () => {
        validate(sourceName)
        validate(targetName)
        if (files.get(sourceName).kind !== 'source' || files.get(targetName).kind !== 'target')
          throw Error('Migration requires owned source and V3 target')
        if (typeof executor !== 'string' || !executor.trim())
          throw Error('Explicit migration executor required')
        const script_sha256 = scriptHash()
        if (expectedScriptSha256 !== undefined && expectedScriptSha256 !== script_sha256)
          throw Error('Script digest mismatch')
        const source = open(sourceName, true),
          target = open(targetName)
        let backup
        try {
          source.exec('BEGIN')
          const data = Object.fromEntries(tables.map((t) => [t, readRows(source, t)]))
          const sourceCheck = check(source)
          source.exec('COMMIT')
          const source_fingerprint = digest(json(data))
          if (schemaFingerprint(target) !== files.get(targetName).schema)
            throw Error('Target schema changed')
          const previous = target
            .prepare('SELECT * FROM schema_migrations WHERE version=?')
            .get(version)
          if (previous) {
            if (
              previous.source_fingerprint !== source_fingerprint ||
              previous.script_sha256 !== script_sha256
            )
              throw Error('Migration source or script differs from committed version')
            const report = JSON.parse(previous.report_json)
            verify(target, 'v3')
            if (
              !report.targetFingerprint ||
              migrationFingerprint(target) !== report.targetFingerprint
            )
              throw Error('Repeat target content fingerprint mismatch')
            for (const table of tables)
              if (
                target
                  .prepare('SELECT COUNT(*) n FROM legacy_records WHERE entity_type=?')
                  .get(table).n !== data[table].length
              )
                throw Error('Repeat verification failed')
            return { ...report, status: 'already_applied' }
          }
          if (Object.values(inventory(target)).some((n) => n !== 0))
            throw Error('Target contains data or prior migration')
          backup = await snapshot(
            target,
            targetName.replace('.db', '-before-import-' + ++backupSequence + '.db'),
            'backup'
          )
          const report = {
            version,
            script_sha256,
            source_fingerprint,
            status: 'applied',
            sourceCounts: Object.fromEntries(tables.map((t) => [t, data[t].length])),
            archiveCounts: {},
            matching: { unique_match: 0, no_match: 0, ambiguous: 0 },
            positions: [],
            invalidPositions: 0,
            anomalies: [],
            sourceCheck,
            backup,
            restore: { status: 'not_run' }
          }
          const anomaly = (entity, id, code) => report.anomalies.push({ entity, id, code })
          const mapping = new Map(),
            titles = new Map()
          const now = Date.now()
          target.exec('BEGIN IMMEDIATE')
          for (const p of data.positions) {
            const list = titles.get(p.title) || []
            list.push(p)
            titles.set(p.title, list)
            if (
              typeof p.title !== 'string' ||
              !p.title.trim() ||
              !['open', 'closed'].includes(p.status) ||
              !dateValid(p.publish_date)
            ) {
              report.invalidPositions++
              anomaly('positions', p.id, 'unsafe_position')
              continue
            }
            const result = target
              .prepare(
                'INSERT INTO positions (title,department,location,status,publish_date,description) VALUES (?,?,?,?,?,?)'
              )
              .run(p.title, p.department, p.location, p.status, p.publish_date, p.description)
            mapping.set(p.id, Number(result.lastInsertRowid))
            report.positions.push({ sourceId: p.id, targetId: Number(result.lastInsertRowid) })
            if (p.candidate_count !== data.candidates.filter((c) => c.position === p.title).length)
              anomaly('positions', p.id, 'cached_count_mismatch')
          }
          let archived = 0
          for (const table of tables) {
            report.archiveCounts[table] = 0
            for (const row of data[table]) {
              let match = 'not_applicable',
                mapped = null,
                facts = {}
              if (table === 'positions') facts = { mapped_position_id: mapping.get(row.id) ?? null }
              if (table === 'candidates') {
                const matches = titles.get(row.position) || []
                match =
                  matches.length === 0
                    ? 'no_match'
                    : matches.length === 1 && mapping.has(matches[0].id)
                      ? 'unique_match'
                      : 'ambiguous'
                if (match === 'unique_match') mapped = mapping.get(matches[0].id)
                report.matching[match]++
                if (match !== 'unique_match') anomaly(table, row.id, match)
                const known = [
                  'screening',
                  'first_interview',
                  'second_interview',
                  'offer'
                ].includes(row.stage)
                facts = {
                  stage: known ? row.stage : null,
                  application_status: row.stage === 'rejected' ? 'closed' : null,
                  outcome: row.stage === 'rejected' ? 'company_rejected' : null,
                  offer_status: null,
                  closed_at: null,
                  closed_reason: null
                }
                if (!known && row.stage !== 'rejected') anomaly(table, row.id, 'unknown_stage')
                if (!dateValid(row.applied_date)) anomaly(table, row.id, 'invalid_applied_date')
              }
              if (table === 'interviews') {
                facts = {
                  stage_scope: null,
                  scheduled_at: null,
                  completed_at: null,
                  cancelled_at: null,
                  status: ['scheduled', 'completed', 'cancelled'].includes(row.status)
                    ? row.status
                    : null
                }
                if (!data.candidates.some((c) => c.id === row.candidate_id))
                  anomaly(table, row.id, 'orphan_candidate')
                if (
                  !dateValid(row.date) ||
                  typeof row.time !== 'string' ||
                  !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)
                )
                  anomaly(table, row.id, 'invalid_date_time')
                anomaly(table, row.id, 'unverified_stage_and_time')
              }
              target
                .prepare(
                  'INSERT INTO legacy_records (source_key,entity_type,legacy_id,raw_json,facts_json,mapped_position_id,mapping_status,imported_at) VALUES (?,?,?,?,?,?,?,?)'
                )
                .run(source_fingerprint, table, row.id, json(row), json(facts), mapped, match, now)
              report.archiveCounts[table]++
              archived++
              if (failAfterArchive === archived) throw Error('Injected migration failure')
            }
          }
          report.targetCheck = check(target)
          if (
            report.targetCheck.foreignKeys.length ||
            json(report.targetCheck.integrity) !== '["ok"]'
          )
            throw Error('Target integrity failure')
          for (const table of tables)
            if (
              report.sourceCounts[table] !==
              target.prepare('SELECT COUNT(*) n FROM legacy_records WHERE entity_type=?').get(table)
                .n
            )
              throw Error('Archive count mismatch')
          report.targetFingerprint = migrationFingerprint(target)
          target
            .prepare('INSERT INTO schema_migrations VALUES (?,?,?,?,?,?)')
            .run(version, script_sha256, source_fingerprint, now, executor, json(report))
          target.exec('COMMIT')
          return report
        } catch (error) {
          if (target.isTransaction) target.exec('ROLLBACK')
          error.report = {
            status: 'failed',
            message: error.message,
            backup,
            rollback: !target.isTransaction,
            counts: inventory(target)
          }
          throw error
        } finally {
          source.close()
          target.close()
        }
      }),
    dispose: () => {
      if (busy) throw Error('Sandbox operation already running')
      validateRoot()
      for (const name of files.keys()) validate(name)
      fs.rmSync(root, { recursive: true })
      disposed = true
    }
  }
}
