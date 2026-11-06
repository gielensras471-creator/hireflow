import { CommandError } from './command-core.js'
import { parseShanghaiDateTime } from './interview-service.js'
import { createRecruitingRead, validateLimit, validateOptions } from './query-read.js'

const applicationUnit = 'application_record'
const interviewUnit = 'interview_record'
const interviewStages = "c.stage IN ('first_interview','second_interview')"
const currentRound = 'i.candidate_id=c.id AND i.stage_scope=c.stage'
const applications = 'FROM candidates c'
const meetings = `${applications} JOIN interviews i ON ${currentRound}`
const withoutFeedback = 'NOT EXISTS (SELECT 1 FROM feedback f WHERE f.interview_id=i.id)'
const active = "c.application_status='active'"
const todayRange =
  "i.status IN ('scheduled','completed','cancelled') AND i.scheduled_at>=? AND i.scheduled_at<?"
const dueHint = '预约开始时间已到，待确认面试状态'
const offerHints = {
  preparing: '待发送 Offer',
  sent: '待候选人回应',
  accepted: '待 HR 确认录用'
}

const work = {
  screening: { where: "c.stage='screening'", hint: '待筛选' },
  scheduling: {
    where: `${interviewStages} AND NOT EXISTS (
      SELECT 1 FROM interviews i WHERE ${currentRound} AND i.status IN ('scheduled','completed')
    )`,
    hint: '待安排面试'
  },
  due: { meeting: true, where: "i.status='scheduled' AND i.scheduled_at<=?", hint: dueHint },
  feedback: {
    meeting: true,
    where: `i.status='completed' AND ${withoutFeedback}`,
    hint: '待提交面评'
  },
  decision: {
    where: `${interviewStages}
      AND EXISTS (SELECT 1 FROM interviews i WHERE ${currentRound} AND i.status='completed')
      AND NOT EXISTS (SELECT 1 FROM interviews i WHERE ${currentRound} AND i.status='scheduled')
      AND NOT EXISTS (
        SELECT 1 FROM interviews i WHERE ${currentRound} AND i.status='completed' AND ${withoutFeedback}
      )`,
    hint: '待 HR 决策'
  },
  offer: { where: "c.stage='offer' AND c.offer_status IN ('preparing','sent','accepted')" }
}

const workScope = ({ meeting, where }) =>
  `${meeting ? meetings : applications} WHERE ${active} AND ${where}`

const applicationFields = `c.id AS candidateId,c.position_id AS positionId,
  c.stage,c.application_status AS applicationStatus,c.offer_status AS offerStatus`
const interviewFields = `i.id AS interviewId,i.stage_scope AS stageScope,i.status AS interviewStatus,
  i.scheduled_at AS scheduledAt,i.completed_at AS completedAt,i.cancelled_at AS cancelledAt`

const metric = (count, unit) => ({ count, unit })
const unitFor = (spec) => (spec.meeting ? interviewUnit : applicationUnit)
const dayMs = 24 * 60 * 60 * 1000
const shanghaiOffsetMs = 8 * 60 * 60 * 1000
const readNow = (clock) => {
  const value = clock()
  if (typeof value !== 'number') throw new CommandError('INVALID_TIME')
  return parseShanghaiDateTime(value)
}
const dayBounds = (now) => {
  const start = Math.floor((now + shanghaiOffsetMs) / dayMs) * dayMs - shanghaiOffsetMs
  return { start, end: start + dayMs }
}

export const createDashboardService = ({ db, resolveActor, clock = Date.now }) => {
  const read = createRecruitingRead(db, resolveActor)

  const listWorkItems = (type, options) => {
    if (typeof type !== 'string' || !Object.hasOwn(work, type))
      throw new CommandError('INVALID_QUERY')
    validateOptions(options, type === 'offer' ? ['limit', 'offset', 'status'] : ['limit', 'offset'])
    const { limit = 50, offset = 0, status } = options
    validateLimit(limit)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
      throw new CommandError('INVALID_QUERY')
    if (status !== undefined && (typeof status !== 'string' || !Object.hasOwn(offerHints, status)))
      throw new CommandError('INVALID_QUERY')

    const spec = work[type]
    const params = type === 'due' ? [readNow(clock)] : []
    let scope = workScope(spec)
    if (status !== undefined) {
      scope += ' AND c.offer_status=?'
      params.push(status)
    }
    // Application-level items use creation time as a reference, with no inferred transition time.
    const businessTime = spec.meeting
      ? type === 'feedback'
        ? 'i.completed_at'
        : 'i.scheduled_at'
      : 'c.created_at'
    const businessTimeKind = spec.meeting
      ? type === 'feedback'
        ? 'interview_completed_at'
        : 'interview_scheduled_at'
      : 'application_created_at'
    const id = spec.meeting ? 'i.id' : 'c.id'
    const fields = spec.meeting ? interviewFields : 'NULL AS interviewId'
    const total = db.prepare(`SELECT COUNT(*) AS n ${scope}`).get(...params).n
    const items = db
      .prepare(
        `SELECT ${applicationFields},${fields},${businessTime} AS businessTime
          ${scope} ORDER BY businessTime,${id} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
      .map((row) => ({
        ...row,
        type,
        businessTimeKind,
        hint: type === 'offer' ? offerHints[row.offerStatus] : spec.hint
      }))
    return { type, unit: unitFor(spec), total, pageCount: items.length, items }
  }

  return Object.freeze({
    summary: (context) =>
      read(context, () => {
        const now = readNow(clock)
        const { start, end } = dayBounds(now)
        const positions = db
          .prepare(
            `SELECT COUNT(*) AS n,COUNT(deleted_at) AS softDeletedOpen
          FROM positions WHERE status='open'`
          )
          .get()
        const counts = db
          .prepare(
            `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE application_status='active') AS active,
          COUNT(*) FILTER (WHERE application_status='closed') AS closed,
          COUNT(*) FILTER (WHERE application_status='closed' AND outcome='hired') AS hired
          FROM candidates`
          )
          .get()
        const today = db
          .prepare(`SELECT COUNT(*) AS n FROM interviews i WHERE ${todayRange}`)
          .get(start, end).n
        const offerByStatus = { preparing: 0, sent: 0, accepted: 0 }
        for (const row of db
          .prepare(
            `SELECT c.offer_status AS status,COUNT(*) AS n
          ${workScope(work.offer)} GROUP BY c.offer_status`
          )
          .all())
          offerByStatus[row.status] = row.n
        const workCounts = {}
        for (const [type, spec] of Object.entries(work)) {
          const count =
            type === 'offer'
              ? Object.values(offerByStatus).reduce((sum, n) => sum + n, 0)
              : db
                  .prepare(`SELECT COUNT(*) AS n ${workScope(spec)}`)
                  .get(...(type === 'due' ? [now] : [])).n
          workCounts[type] = metric(count, unitFor(spec))
        }
        return {
          now,
          timezone: 'Asia/Shanghai',
          openPositions: {
            ...metric(positions.n, 'position_record'),
            softDeletedOpen: positions.softDeletedOpen
          },
          activeApplications: metric(counts.active, applicationUnit),
          todayInterviews: metric(today, interviewUnit),
          applicationTotals: { ...counts, unit: applicationUnit },
          work: workCounts,
          offerByStatus
        }
      }),
    workItems: (context, type, options = {}) => read(context, () => listWorkItems(type, options)),
    offerWorkItems: (context, status, options = {}) =>
      read(context, () => {
        validateOptions(options, ['limit', 'offset'])
        return listWorkItems('offer', { ...options, status })
      }),
    todayInterviews: (context, options) =>
      read(context, () => {
        const paged = options !== undefined
        if (paged) validateOptions(options, ['limit', 'offset'])
        const { limit = 50, offset = 0 } = options ?? {}
        if (paged) {
          validateLimit(limit)
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
            throw new CommandError('INVALID_QUERY')
        }
        const now = readNow(clock)
        const { start, end } = dayBounds(now)
        const byStatus = { scheduled: 0, completed: 0, cancelled: 0 }
        for (const row of db
          .prepare(
            'SELECT i.status,COUNT(*) AS count FROM interviews i WHERE ' +
              todayRange +
              ' GROUP BY i.status'
          )
          .all(start, end))
          byStatus[row.status] = row.count
        const total = byStatus.scheduled + byStatus.completed + byStatus.cancelled
        const items = db
          .prepare(
            `SELECT ${applicationFields},${interviewFields}
          FROM interviews i JOIN candidates c ON c.id=i.candidate_id
          WHERE ${todayRange} ORDER BY i.scheduled_at,i.id${paged ? ' LIMIT ? OFFSET ?' : ''}`
          )
          .all(start, end, ...(paged ? [limit, offset] : []))
          .map((row) => {
            const due = row.interviewStatus === 'scheduled' && now >= row.scheduledAt
            return { ...row, due, hint: due ? dueHint : null }
          })
        return {
          timezone: 'Asia/Shanghai',
          start,
          end,
          total,
          unit: interviewUnit,
          byStatus,
          ...(paged ? { limit, offset } : {}),
          items
        }
      })
  })
}
