import { createHash, randomUUID } from 'node:crypto'

export class CommandError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'CommandError'
    this.code = code
  }
}
const fail = (code) => {
  throw new CommandError(code)
}
// JSON only: reject lossy/ambiguous JS values; sort object keys recursively.
export const canonicalRequest = (value) => {
  const ancestors = new Set()
  const visit = (v) => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v)
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) fail('INVALID_REQUEST')
      return JSON.stringify(v)
    }
    if (typeof v !== 'object' || ancestors.has(v)) fail('INVALID_REQUEST')
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      fail('INVALID_REQUEST')
    if (Object.getOwnPropertySymbols(v).length) fail('INVALID_REQUEST')
    ancestors.add(v)
    let result
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) fail('INVALID_REQUEST')
      result = '[' + Array.from({ length: v.length }, (_, i) => visit(v[i])).join(',') + ']'
    } else
      result =
        '{' +
        Object.keys(v)
          .sort()
          .map((k) => {
            const d = Object.getOwnPropertyDescriptor(v, k)
            if (!('value' in d)) fail('INVALID_REQUEST')
            return JSON.stringify(k) + ':' + visit(d.value)
          })
          .join(',') +
        '}'
    ancestors.delete(v)
    return result
  }
  return visit(value)
}
const sync = (fn, ...args) => {
  if (typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') fail('ASYNC_OPERATION')
  const value = fn(...args)
  if (value && typeof value.then === 'function') {
    Promise.resolve(value).catch(() => {})
    fail('ASYNC_OPERATION')
  }
  return value
}
const frozen = (value) => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item)
    Object.freeze(value)
  }
  return value
}
// Server-only composition API. resolveActor must verify the authentication context;
// authorize must explicitly grant write access from the CURRENT database user.
// Never expose register/resolveActor/authorize or service callbacks to request bodies.
export const createCommandCore = ({ db, resolveActor, authorize }) => {
  if (typeof resolveActor !== 'function' || typeof authorize !== 'function')
    fail('AUTH_POLICY_REQUIRED')
  const definitions = new Map()
  const register = (name, definition) => {
    if (typeof name !== 'string' || !name.trim() || definitions.has(name)) fail('INVALID_COMMAND')
    if (!['position', 'candidate'].includes(definition.aggregate)) fail('INVALID_AGGREGATE')
    if (typeof definition.eventType !== 'string' || typeof definition.change !== 'function')
      fail('INVALID_COMMAND')
    if (
      definition.mode !== undefined &&
      !['create', 'update', 'activity'].includes(definition.mode)
    )
      fail('INVALID_COMMAND')
    if (definition.mode === 'activity' && definition.aggregate !== 'candidate')
      fail('INVALID_AGGREGATE')
    definitions.set(name, Object.freeze({ ...definition }))
  }
  const execute = (context, request) => {
    if (db.isTransaction) fail('NESTED_TRANSACTION')
    if (
      db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1 ||
      db.prepare('PRAGMA recursive_triggers').get().recursive_triggers !== 1
    )
      fail('UNSAFE_CONNECTION')
    if (
      db
        .prepare('PRAGMA database_list')
        .all()
        .some((r) => !['main', 'temp'].includes(r.name))
    )
      fail('UNSAFE_CONNECTION')
    const r = frozen(JSON.parse(canonicalRequest(request)))
    if (
      !r ||
      Array.isArray(r) ||
      Object.keys(r).some(
        (k) =>
          !['command', 'aggregateId', 'expectedVersion', 'idempotencyKey', 'payload'].includes(k)
      )
    )
      fail('INVALID_REQUEST')
    const def = definitions.get(r.command)
    if (!def) fail('UNKNOWN_COMMAND')
    if (
      (def.mode === 'create'
        ? Object.hasOwn(r, 'aggregateId') || Object.hasOwn(r, 'expectedVersion')
        : !Number.isSafeInteger(r.aggregateId) ||
          r.aggregateId < 1 ||
          !Number.isSafeInteger(r.expectedVersion) ||
          r.expectedVersion < 1 ||
          r.expectedVersion >= Number.MAX_SAFE_INTEGER) ||
      typeof r.idempotencyKey !== 'string' ||
      !r.idempotencyKey.trim()
    )
      fail('INVALID_REQUEST')
    const hash = createHash('sha256').update(canonicalRequest(r)).digest('hex')
    const table = def.aggregate === 'position' ? 'positions' : 'candidates'
    try {
      db.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if (/locked|busy/i.test(error.message)) fail('COMMAND_BUSY')
      throw error
    }
    try {
      const userId = sync(resolveActor, context)
      if (!Number.isSafeInteger(userId) || userId < 1) fail('INVALID_ACTOR')
      const user = db
        .prepare('SELECT id,username,name,role,department,email,phone FROM users WHERE id=?')
        .get(userId)
      if (!user || typeof user.name !== 'string' || !user.name.trim()) fail('INVALID_ACTOR')
      if (sync(authorize, frozen({ ...user }), r.command) !== true) fail('FORBIDDEN')
      const oldReceipt = db
        .prepare('SELECT * FROM command_receipts WHERE actor_user_id=? AND idempotency_key=?')
        .get(userId, r.idempotencyKey)
      if (oldReceipt) {
        if (oldReceipt.request_sha256 !== hash) fail('IDEMPOTENCY_CONFLICT')
        const result = JSON.parse(oldReceipt.result_json)
        db.exec('COMMIT')
        return { replayed: true, result }
      }
      const activity = def.mode === 'activity'
      const creating = def.mode === 'create'
      const before = creating
        ? null
        : db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(r.aggregateId)
      if (!creating && !before) fail('AGGREGATE_NOT_FOUND')
      if (!creating && before.version !== r.expectedVersion) fail('VERSION_CONFLICT')
      let subjectBefore = null
      if (activity && r.payload?.interview_id !== undefined) {
        if (!Number.isSafeInteger(r.payload.interview_id) || r.payload.interview_id < 1)
          fail('INVALID_INTERVIEW')
        subjectBefore = db
          .prepare('SELECT * FROM interviews WHERE id=?')
          .get(r.payload.interview_id)
        if (!subjectBefore || subjectBefore.candidate_id !== before.id)
          fail('INTERVIEW_ASSOCIATION_CONFLICT')
      }
      const now = Date.now(),
        commandId = randomUUID()
      const patch = sync(
        def.change,
        creating ? null : frozen({ ...before }),
        r.payload,
        frozen({ ...user }),
        now
      )
      canonicalRequest(patch)
      if (!patch || Array.isArray(patch) || typeof patch !== 'object') fail('INVALID_PATCH')
      const keys = Object.keys(patch)
      const allowed = db
        .prepare('PRAGMA table_info(' + table + ')')
        .all()
        .map((c) => c.name)
      if (
        activity
          ? keys.length !== 1 || keys[0] !== 'interviewId'
          : !keys.length || keys.some((k) => !allowed.includes(k) || ['id', 'version'].includes(k))
      )
        fail('INVALID_PATCH')
      let id = r.aggregateId
      let subjectAfter = null
      if (activity) {
        if (!Number.isSafeInteger(patch.interviewId) || patch.interviewId < 1)
          fail('INVALID_INTERVIEW')
        subjectAfter = db.prepare('SELECT * FROM interviews WHERE id=?').get(patch.interviewId)
        if (
          !subjectAfter ||
          subjectAfter.candidate_id !== before.id ||
          (subjectBefore && subjectBefore.id !== subjectAfter.id)
        )
          fail('INTERVIEW_ASSOCIATION_CONFLICT')
        const changed = db
          .prepare('UPDATE candidates SET version=version+1 WHERE id=? AND version=?')
          .run(before.id, r.expectedVersion)
        if (changed.changes !== 1) fail('VERSION_CONFLICT')
      } else if (creating) {
        const inserted = db
          .prepare(
            'INSERT INTO ' +
              table +
              ' (' +
              keys.map((k) => '"' + k + '"').join(',') +
              ',version) VALUES (' +
              keys.map(() => '?').join(',') +
              ',1)'
          )
          .run(...keys.map((k) => patch[k]))
        id = Number(inserted.lastInsertRowid)
      } else {
        const updated = db
          .prepare(
            'UPDATE ' +
              table +
              ' SET ' +
              keys.map((k) => '"' + k + '"=?').join(',') +
              ',version=version+1 WHERE id=? AND version=?'
          )
          .run(...keys.map((k) => patch[k]), id, r.expectedVersion)
        if (updated.changes !== 1) fail('VERSION_CONFLICT')
      }
      const after = db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id)
      const metadata = def.describe
        ? sync(def.describe, before ? frozen({ ...before }) : null, frozen({ ...after }), r.payload)
        : {}
      canonicalRequest(metadata)
      if (
        !metadata ||
        Object.keys(metadata).some(
          (k) => !['reason', 'interviewId', 'feedbackId', 'context'].includes(k)
        )
      )
        fail('INVALID_EVENT_METADATA')
      if (
        activity &&
        metadata.interviewId !== undefined &&
        metadata.interviewId !== subjectAfter.id
      )
        fail('INVALID_EVENT_METADATA')
      const result = {
        commandId,
        aggregate: def.aggregate,
        aggregateId: after.id,
        version: after.version,
        ...(activity
          ? { interviewId: subjectAfter.id, interviewVersion: subjectAfter.version }
          : {})
      }
      // Immediate FK business_events.command_id -> receipts requires this insertion order.
      db.prepare(
        'INSERT INTO command_receipts(command_id,actor_user_id,idempotency_key,request_sha256,result_json,committed_at) VALUES (?,?,?,?,?,?)'
      ).run(commandId, user.id, r.idempotencyKey, hash, JSON.stringify(result), now)
      db.prepare(
        'INSERT INTO business_events(aggregate_type,position_id,candidate_id,interview_id,feedback_id,command_id,aggregate_version,event_type,actor_user_id,actor_name_snapshot,occurred_at,reason,old_values_json,new_values_json,context_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(
        def.aggregate,
        def.aggregate === 'position' ? after.id : null,
        def.aggregate === 'candidate' ? after.id : null,
        activity ? subjectAfter.id : metadata.interviewId ?? null,
        metadata.feedbackId ?? null,
        commandId,
        after.version,
        def.eventType,
        user.id,
        user.name,
        now,
        metadata.reason ?? null,
        JSON.stringify(activity ? subjectBefore : before),
        JSON.stringify(activity ? subjectAfter : after),
        JSON.stringify(metadata.context ?? {})
      )
      db.exec('COMMIT')
      return { replayed: false, result }
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }
  return Object.freeze({ register, execute })
}
