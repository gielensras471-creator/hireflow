import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'
const fail = (code) => {
  throw new CommandError(code)
}
const positive = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_ID')
  return value
}
const shanghaiOffset = 8 * 3600000
// Preserve the existing non-negative SQLite range and four-digit local year format.
const latestLocalInstant = Date.parse('9999-12-31T23:59:59.999+08:00')
const instant = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > latestLocalInstant) fail('INVALID_TIME')
  return value
}
const formatShanghaiDateTime = (value) =>
  new Date(instant(value) + shanghaiOffset).toISOString().slice(0, 19) + '+08:00'
// Local date-times explicitly mean Asia/Shanghai, independent of process/browser TZ.
// Accepted strings: YYYY-MM-DDTHH:mm:ss, optionally suffixed by +08:00; integers are epoch ms.
export const parseShanghaiDateTime = (value) => {
  if (typeof value === 'number') return instant(value)
  if (typeof value !== 'string') fail('INVALID_TIME')
  const local = value.replace(/\+08:00$/, '')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) fail('INVALID_TIME')
  const ms = Date.parse(local + '+08:00')
  instant(ms)
  if (formatShanghaiDateTime(ms) !== local + '+08:00') fail('INVALID_TIME')
  return ms
}
const payload = (p, allowed, required) => {
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).some((k) => !allowed.includes(k)) ||
    required.some((k) => !Object.hasOwn(p, k))
  )
    fail('INVALID_FIELDS')
}
export const createInterviewService = ({ db, resolveActor, clock = Date.now }) => {
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  const active = (b) => {
    if (b.application_status !== 'active') fail('APPLICATION_CLOSED')
  }
  core.register('interview.schedule', {
    aggregate: 'candidate',
    mode: 'activity',
    eventType: 'interview_scheduled',
    change: (b, p, _u, now) => {
      active(b)
      if (!['first_interview', 'second_interview'].includes(b.stage))
        fail('INVALID_INTERVIEW_STAGE')
      payload(p, ['scheduled_at', 'interviewer_name', 'note'], ['scheduled_at', 'interviewer_name'])
      if (
        typeof p.interviewer_name !== 'string' ||
        !p.interviewer_name.trim() ||
        (p.note !== undefined && typeof p.note !== 'string')
      )
        fail('INVALID_FIELDS')
      const time = parseShanghaiDateTime(p.scheduled_at)
      if (
        db.prepare("SELECT 1 FROM interviews WHERE candidate_id=? AND status='scheduled'").get(b.id)
      )
        fail('INTERVIEW_ALREADY_SCHEDULED')
      const row = db
        .prepare(
          "INSERT INTO interviews(candidate_id,stage_scope,scheduled_at,interviewer_name,note,status,created_at,version) VALUES (?,?,?,?,?,'scheduled',?,1)"
        )
        .run(b.id, b.stage, time, p.interviewer_name, p.note ?? '', now)
      return { interviewId: Number(row.lastInsertRowid) }
    }
  })
  for (const action of ['reschedule', 'complete', 'cancel'])
    core.register('interview.' + action, {
      aggregate: 'candidate',
      mode: 'activity',
      eventType: {
        reschedule: 'interview_rescheduled',
        complete: 'interview_completed',
        cancel: 'interview_cancelled'
      }[action],
      change: (b, p, _u, now) => {
        active(b)
        const extra =
          action === 'reschedule' ? ['scheduled_at'] : action === 'cancel' ? ['reason'] : []
        payload(
          p,
          ['interview_id', 'interview_version', ...extra],
          ['interview_id', 'interview_version', ...extra]
        )
        const interview = db
          .prepare('SELECT * FROM interviews WHERE id=? AND candidate_id=?')
          .get(positive(p.interview_id), b.id)
        if (!interview) fail('INTERVIEW_ASSOCIATION_CONFLICT')
        if (interview.version !== positive(p.interview_version)) fail('INTERVIEW_VERSION_CONFLICT')
        if (interview.version >= Number.MAX_SAFE_INTEGER) fail('INTERVIEW_VERSION_CONFLICT')
        if (interview.status !== 'scheduled') fail('INTERVIEW_NOT_SCHEDULED')
        let patch
        if (action === 'reschedule') {
          const time = parseShanghaiDateTime(p.scheduled_at)
          if (time === interview.scheduled_at) fail('NO_CHANGE')
          patch = { scheduled_at: time }
        } else if (action === 'complete') patch = { status: 'completed', completed_at: now }
        else {
          if (typeof p.reason !== 'string' || !p.reason.trim()) fail('CANCEL_REASON_REQUIRED')
          patch = { status: 'cancelled', cancelled_at: now, cancel_reason: p.reason }
        }
        const keys = Object.keys(patch)
        const result = db
          .prepare(
            'UPDATE interviews SET ' +
              keys.map((k) => k + '=?').join(',') +
              ",version=version+1 WHERE id=? AND candidate_id=? AND version=? AND status='scheduled'"
          )
          .run(...Object.values(patch), interview.id, b.id, p.interview_version)
        if (result.changes !== 1) fail('INTERVIEW_VERSION_CONFLICT')
        return { interviewId: interview.id }
      },
      describe: (_b, _a, p) => (action === 'cancel' ? { reason: p.reason } : {})
    })
  const auth = (context) => requireRecruitingActor(db, resolveActor, context)
  const select = `SELECT i.*,c.name AS candidate_name,c.stage AS application_stage,c.application_status,c.version AS application_version,p.id AS position_id,p.title AS position_title FROM interviews i JOIN candidates c ON c.id=i.candidate_id JOIN positions p ON p.id=c.position_id`
  const decorate = (row, now) => {
    const due = row.status === 'scheduled' && now >= row.scheduled_at
    return {
      ...row,
      business_time_zone: 'Asia/Shanghai',
      scheduled_local: formatShanghaiDateTime(row.scheduled_at),
      start_time_reached: due,
      reminder: due ? '预约开始时间已到，待确认面试状态' : null
    }
  }
  const now = () => instant(clock())
  return Object.freeze({
    execute: core.execute,
    list: (context) => {
      auth(context)
      const time = now()
      return db
        .prepare(select + ' ORDER BY i.scheduled_at,i.id')
        .all()
        .map((r) => decorate(r, time))
    },
    detail: (context, id) => {
      auth(context)
      const row = db.prepare(select + ' WHERE i.id=?').get(positive(id))
      if (!row) fail('INTERVIEW_NOT_FOUND')
      return decorate(row, now())
    },
    byApplication: (context, id) => {
      auth(context)
      positive(id)
      if (!db.prepare('SELECT 1 FROM candidates WHERE id=?').get(id)) fail('AGGREGATE_NOT_FOUND')
      const time = now()
      return db
        .prepare(select + ' WHERE i.candidate_id=? ORDER BY i.scheduled_at,i.id')
        .all(id)
        .map((r) => decorate(r, time))
    }
  })
}
