import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'
const nextStage = {
  screening: 'first_interview',
  first_interview: 'second_interview',
  second_interview: 'offer'
}
const fail = (code, details) => {
  const error = new CommandError(code)
  if (details) error.details = details
  throw error
}
export const createAdvancementService = ({ db, resolveActor }) => {
  const assess = (b) => {
    const interviews = db
      .prepare(
        'SELECT i.*,f.id AS feedback_id,f.recommendation FROM interviews i LEFT JOIN feedback f ON f.interview_id=i.id WHERE i.candidate_id=? AND i.stage_scope=? ORDER BY i.id'
      )
      .all(b.id, b.stage)
    const scheduled = interviews.filter((i) => i.status === 'scheduled'),
      completed = interviews.filter((i) => i.status === 'completed'),
      cancelled = interviews.filter((i) => i.status === 'cancelled')
    const missing = completed
      .filter((i) => i.feedback_id === null)
      .map((i) => ({ interviewId: i.id, stageScope: i.stage_scope }))
    const target = nextStage[b.stage] ?? null
    const blockedReason =
      b.application_status !== 'active'
        ? 'APPLICATION_CLOSED'
        : !target
          ? 'NO_NEXT_STAGE'
          : scheduled.length
            ? 'SCHEDULED_INTERVIEW_PENDING'
            : null
    const reasonType =
      !target || b.stage === 'screening'
        ? null
        : completed.length === 0
          ? 'skip_evaluation'
          : missing.length
            ? 'missing_feedback'
            : null
    return {
      candidateId: b.id,
      version: b.version,
      fromStage: b.stage,
      toStage: target,
      blockedReason,
      canAdvance: !blockedReason && !reasonType,
      canAdvanceWithReason: !blockedReason && !!reasonType,
      reasonType,
      scheduled,
      completed,
      cancelled,
      completedCount: completed.length,
      missingInterviews: missing,
      missingInterviewIds: missing.map((i) => i.interviewId)
    }
  }
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  core.register('application.advance', {
    aggregate: 'candidate',
    eventType: 'stage_advanced',
    change: (b, p) => {
      if (
        !p ||
        typeof p !== 'object' ||
        Array.isArray(p) ||
        Object.keys(p).some((k) => !['reason', 'target_stage'].includes(k))
      )
        fail('INVALID_FIELDS')
      if (Object.hasOwn(p, 'reason') && typeof p.reason !== 'string') fail('INVALID_REASON')
      const assessment = assess(b)
      if (assessment.blockedReason) fail(assessment.blockedReason, assessment)
      if (Object.hasOwn(p, 'target_stage') && p.target_stage !== assessment.toStage)
        fail('INVALID_STAGE_TRANSITION')
      if (assessment.reasonType && !(typeof p.reason === 'string' && p.reason.trim()))
        fail('ADVANCEMENT_REASON_REQUIRED', assessment)
      return {
        stage: assessment.toStage,
        ...(assessment.toStage === 'offer' ? { offer_status: 'preparing' } : {})
      }
    },
    describe: (b, a, p) => {
      const assessment = assess(b)
      return {
        reason: p.reason?.trim() ? p.reason : null,
        context: {
          fromStage: b.stage,
          toStage: a.stage,
          kind: assessment.reasonType ?? 'normal',
          missingInterviews: assessment.missingInterviews,
          completedInterviewIds: assessment.completed.map((i) => i.id)
        }
      }
    },
    afterEvent: ({ event }) => {
      const facts = JSON.parse(event.context_json)
      for (const missing of facts.missingInterviews)
        db.prepare(
          'INSERT INTO advancement_missing_feedback(event_id,interview_id,candidate_id,stage_scope) VALUES (?,?,?,?)'
        ).run(event.id, missing.interviewId, event.candidate_id, missing.stageScope)
    }
  })
  const read = (id) => {
    if (!Number.isSafeInteger(id) || id < 1) fail('INVALID_ID')
    const row = db.prepare('SELECT * FROM candidates WHERE id=?').get(id)
    if (!row) fail('AGGREGATE_NOT_FOUND')
    return row
  }
  return Object.freeze({
    execute: core.execute,
    preflight: (context, id) => {
      requireRecruitingActor(db, resolveActor, context)
      return assess(read(id))
    },
    history: (context, id) => {
      requireRecruitingActor(db, resolveActor, context)
      read(id)
      return db
        .prepare(
          "SELECT * FROM business_events WHERE candidate_id=? AND event_type='stage_advanced' ORDER BY id"
        )
        .all(id)
        .map((event) => ({
          ...event,
          context: JSON.parse(event.context_json),
          missing: db
            .prepare(
              'SELECT interview_id,stage_scope FROM advancement_missing_feedback WHERE event_id=? ORDER BY interview_id'
            )
            .all(event.id)
        }))
    }
  })
}
