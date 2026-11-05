import { CommandError } from './command-core.js'
import { createFeedbackService } from './feedback-service.js'
import { createRecruitingRead, positiveId, validateLimit, validateOptions } from './query-read.js'

const positionEvents = new Set([
  'position_created',
  'position_updated',
  'position_status_changed',
  'position_deleted'
])
const applicationEvents = new Set([
  'candidate_created',
  'candidate_updated',
  'stage_advanced',
  'application_closed',
  'interview_scheduled',
  'interview_rescheduled',
  'interview_completed',
  'interview_cancelled',
  'feedback_submitted',
  'feedback_supplemented',
  'feedback_corrected',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'candidate_hired'
])
const legacyEntities = new Set(['positions', 'candidates', 'interviews'])
const validateId = (id) => {
  if (!positiveId(id)) throw new CommandError('INVALID_ID')
}

const pageOptions = (options, eventTypes) => {
  validateOptions(options, ['limit', 'after', 'eventType'])
  const { limit = 50, after, eventType } = options
  validateLimit(limit)
  if (eventType !== undefined && !eventTypes.has(eventType)) throw new CommandError('INVALID_QUERY')
  if (after !== undefined) {
    validateOptions(after, ['occurredAt', 'eventId'])
    if (
      !Number.isSafeInteger(after.occurredAt) ||
      after.occurredAt < 0 ||
      !positiveId(after.eventId)
    )
      throw new CommandError('INVALID_QUERY')
  }
  return { limit, after, eventType }
}

const priorDecisions = `
  CASE WHEN e.event_type='feedback_corrected' THEN (
    SELECT prior.id FROM business_events prior JOIN interviews i ON i.id=e.interview_id
    WHERE prior.aggregate_type='candidate' AND prior.candidate_id=e.candidate_id AND prior.event_type='stage_advanced'
      AND prior.aggregate_version<e.aggregate_version
      AND json_extract(prior.old_values_json,'$.stage')=i.stage_scope
    ORDER BY prior.aggregate_version DESC LIMIT 1
  ) END AS priorAdvancementEventId,
  CASE WHEN e.event_type='feedback_corrected' THEN (
    SELECT prior.id FROM business_events prior
    WHERE prior.aggregate_type='candidate' AND prior.candidate_id=e.candidate_id AND prior.aggregate_version<e.aggregate_version
      AND prior.event_type IN ('application_closed','offer_declined','candidate_hired')
    ORDER BY prior.aggregate_version DESC LIMIT 1
  ) END AS priorClosureEventId
`

export const createHistoryService = ({ db, resolveActor }) => {
  const read = createRecruitingRead(db, resolveActor)
  const feedback = createFeedbackService({ db, resolveActor })

  const application = (id) => {
    validateId(id)
    const row = db
      .prepare(
        `SELECT p.id AS positionId,p.title FROM candidates c
      JOIN positions p ON p.id=c.position_id WHERE c.id=?`
      )
      .get(id)
    if (!row) throw new CommandError('AGGREGATE_NOT_FOUND')
    return { ...row }
  }

  const advancementLinks = (ids) => {
    const links = new Map()
    if (!ids.length) return links
    // A supplement links back to the original immutable waiver, even on a different page.
    const rows = db
      .prepare(
        `SELECT m.event_id AS eventId,m.interview_id AS interviewId,
        m.stage_scope AS stageScope,s.id AS supplementEventId,s.occurred_at AS supplementedAt,
        s.actor_user_id AS supplementActorUserId,s.actor_name_snapshot AS supplementActorNameSnapshot
      FROM advancement_missing_feedback m
      JOIN business_events a ON a.id=m.event_id AND a.candidate_id=m.candidate_id
      LEFT JOIN business_events s ON s.id=(
        SELECT e.id FROM business_events e
        WHERE e.candidate_id=m.candidate_id AND e.interview_id=m.interview_id
          AND e.event_type='feedback_supplemented' AND e.aggregate_version>a.aggregate_version
          AND json_extract(e.context_json,'$.waiverEventId')=m.event_id
          AND json_extract(e.context_json,'$.stageScope')=m.stage_scope
        ORDER BY e.aggregate_version LIMIT 1
      )
      WHERE m.event_id IN (SELECT value FROM json_each(?))
      ORDER BY m.event_id,m.interview_id`
      )
      .all(JSON.stringify(ids))
    for (const { eventId, ...link } of rows) {
      if (!links.has(eventId)) links.set(eventId, [])
      links.get(eventId).push(link)
    }
    return links
  }

  const eventPage = (id, isApplication, options, positionId) => {
    const { limit, after, eventType } = pageOptions(
      options,
      isApplication ? applicationEvents : positionEvents
    )
    const column = isApplication ? 'e.candidate_id' : 'e.position_id'
    const type = isApplication ? 'candidate' : 'position'
    const conditions = [`${column}=?`, 'e.aggregate_type=?']
    const args = [id, type]
    if (eventType !== undefined) {
      conditions.push('e.event_type=?')
      args.push(eventType)
    }
    if (after !== undefined) {
      conditions.push('(e.occurred_at,e.id)>(?,?)')
      args.push(after.occurredAt, after.eventId)
    }
    const rows = db
      .prepare(
        `SELECT e.*${isApplication ? ', ' + priorDecisions : ''}
      FROM business_events e WHERE ${conditions.join(' AND ')}
      ORDER BY e.occurred_at,e.id LIMIT ?`
      )
      .all(...args, limit + 1)
    const hasMore = rows.length > limit
    if (hasMore) rows.pop()

    const missing = advancementLinks(
      rows.filter((row) => row.event_type === 'stage_advanced').map((row) => row.id)
    )
    const items = rows.map((row) => {
      const event = {
        eventId: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: id,
        candidateId: row.candidate_id,
        // The application's position ID is an immutable association, independent of event snapshots.
        positionId,
        interviewId: row.interview_id,
        feedbackId: row.feedback_id,
        commandId: row.command_id,
        actorUserId: row.actor_user_id,
        actorNameSnapshot: row.actor_name_snapshot,
        occurredAt: row.occurred_at,
        reason: row.reason,
        before: JSON.parse(row.old_values_json),
        after: JSON.parse(row.new_values_json),
        context: JSON.parse(row.context_json),
        aggregateVersion: row.aggregate_version
      }
      if (event.eventType === 'stage_advanced')
        event.missingFeedbackLinks = missing.get(row.id) ?? []
      if (event.eventType === 'feedback_corrected')
        event.priorDecisions = {
          advancementEventId: row.priorAdvancementEventId,
          closureEventId: row.priorClosureEventId
        }
      return event
    })
    const last = items.at(-1)
    return {
      items,
      nextCursor: hasMore ? { occurredAt: last.occurredAt, eventId: last.eventId } : null
    }
  }

  return Object.freeze({
    byApplication: (context, candidateId, options = {}) =>
      read(context, () => {
        const currentPosition = application(candidateId)
        return {
          candidateId,
          currentPosition,
          ...eventPage(candidateId, true, options, currentPosition.positionId)
        }
      }),
    byPosition: (context, positionId, options = {}) =>
      read(context, () => {
        validateId(positionId)
        if (!db.prepare('SELECT id FROM positions WHERE id=?').get(positionId))
          throw new CommandError('AGGREGATE_NOT_FOUND')
        return { positionId, ...eventPage(positionId, false, options, positionId) }
      }),
    historicalMissing: (context, candidateId) =>
      read(context, () => feedback.historicalMissing(context, candidateId)),
    legacyRecord: (context, key) =>
      read(context, () => {
        validateOptions(key, ['sourceKey', 'entityType', 'legacyId'])
        const { sourceKey, entityType, legacyId } = key
        if (
          typeof sourceKey !== 'string' ||
          !sourceKey.trim() ||
          sourceKey.length > 128 ||
          !legacyEntities.has(entityType) ||
          !Number.isSafeInteger(legacyId)
        )
          throw new CommandError('INVALID_QUERY')
        const row = db
          .prepare(
            `SELECT * FROM legacy_records
          WHERE source_key=? AND entity_type=? AND legacy_id=?`
          )
          .get(sourceKey, entityType, legacyId)
        if (!row) throw new CommandError('LEGACY_RECORD_NOT_FOUND')
        return {
          sourceKey: row.source_key,
          entityType: row.entity_type,
          legacyId: row.legacy_id,
          mappingStatus: row.mapping_status,
          mappedPositionId: row.mapped_position_id,
          importedAt: row.imported_at,
          historyStatus: 'history_unknown',
          hint: '旧版待核实／历史未知',
          raw: JSON.parse(row.raw_json),
          facts: JSON.parse(row.facts_json)
        }
      })
  })
}
