import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'

const fail = (code) => {
  throw new CommandError(code)
}
const evaluationFields = ['reviewer_name', 'recommendation', 'reason']
const stageOrder = ['screening', 'first_interview', 'second_interview', 'offer']
const positiveId = (value) => Number.isSafeInteger(value) && value > 0

const validateEvaluation = (payload, correcting = false) => {
  const allowed = ['interview_id', ...evaluationFields]
  if (correcting) allowed.push('feedback_revision', 'correction_reason')
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !allowed.includes(key))
  )
    fail('INVALID_FIELDS')
  if (!positiveId(payload.interview_id)) fail('INVALID_INTERVIEW')
  for (const key of ['reviewer_name', 'reason']) {
    if (correcting && !Object.hasOwn(payload, key)) continue
    if (typeof payload[key] !== 'string' || !payload[key].trim()) fail('INVALID_FEEDBACK')
  }
  if (
    (!correcting || Object.hasOwn(payload, 'recommendation')) &&
    !['recommend', 'not_recommend', 'undecided'].includes(payload.recommendation)
  )
    fail('INVALID_RECOMMENDATION')
}

export const createFeedbackService = ({ db, resolveActor }) => {
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  const auth = (context) => requireRecruitingActor(db, resolveActor, context)
  const application = (id) => {
    if (!positiveId(id)) fail('INVALID_ID')
    const row = db.prepare('SELECT * FROM candidates WHERE id=?').get(id)
    if (!row) fail('AGGREGATE_NOT_FOUND')
    return row
  }
  const interview = (candidateId, interviewId) => {
    if (!positiveId(interviewId)) fail('INVALID_INTERVIEW')
    const row = db
      .prepare('SELECT * FROM interviews WHERE id=? AND candidate_id=?')
      .get(interviewId, candidateId)
    if (!row) fail('INTERVIEW_ASSOCIATION_CONFLICT')
    return row
  }
  const currentFeedback = (interviewId) =>
    db.prepare('SELECT * FROM feedback WHERE interview_id=?').get(interviewId)

  // Both the immutable association and the actual decision snapshot must attest to the waiver.
  const waivers = (candidateId, interviewId = null) =>
    db
      .prepare(
        `
    SELECT m.interview_id, m.stage_scope, e.id AS event_id, e.occurred_at, e.reason,
      e.context_json, e.old_values_json, e.new_values_json
    FROM advancement_missing_feedback m
    JOIN business_events e ON e.id=m.event_id AND e.candidate_id=m.candidate_id
    WHERE m.candidate_id=? AND (? IS NULL OR m.interview_id=?)
      AND e.aggregate_type='candidate' AND e.event_type='stage_advanced'
    ORDER BY e.aggregate_version,m.interview_id
  `
      )
      .all(candidateId, interviewId, interviewId)
      .flatMap((row) => {
        const context = JSON.parse(row.context_json)
        const before = JSON.parse(row.old_values_json)
        const after = JSON.parse(row.new_values_json)
        const nextStage = stageOrder[stageOrder.indexOf(row.stage_scope) + 1]
        if (
          !row.reason?.trim() ||
          context?.kind !== 'missing_feedback' ||
          context.fromStage !== row.stage_scope ||
          context.toStage !== nextStage ||
          before?.id !== candidateId ||
          before.stage !== row.stage_scope ||
          before.application_status !== 'active' ||
          after?.id !== candidateId ||
          after.stage !== nextStage ||
          after.application_status !== 'active' ||
          !Array.isArray(context.missingInterviews) ||
          !context.missingInterviews.some(
            (item) => item?.interviewId === row.interview_id && item.stageScope === row.stage_scope
          )
        )
          return []
        return [
          {
            interviewId: row.interview_id,
            stageScope: row.stage_scope,
            eventId: row.event_id,
            occurredAt: row.occurred_at,
            reason: row.reason,
            toStage: nextStage
          }
        ]
      })

  const supplementBlock = (candidate, meeting, feedback, waiver) => {
    if (candidate.application_status !== 'active') return 'APPLICATION_CLOSED'
    if (meeting.status !== 'completed') return 'INTERVIEW_NOT_COMPLETED'
    if (stageOrder.indexOf(meeting.stage_scope) >= stageOrder.indexOf(candidate.stage))
      return 'NOT_PAST_INTERVIEW_ROUND'
    if (feedback) return 'FEEDBACK_ALREADY_EXISTS'
    if (!waiver) return 'HISTORICAL_WAIVER_REQUIRED'
    return null
  }

  for (const supplement of [false, true]) {
    core.register(supplement ? 'feedback.supplement' : 'feedback.submit', {
      aggregate: 'candidate',
      mode: 'feedback',
      eventType: supplement ? 'feedback_supplemented' : 'feedback_submitted',
      change: (candidate, payload, user, now) => {
        if (candidate.application_status !== 'active') fail('APPLICATION_CLOSED')
        validateEvaluation(payload)
        const meeting = interview(candidate.id, payload.interview_id)
        if (supplement) {
          const block = supplementBlock(
            candidate,
            meeting,
            currentFeedback(meeting.id),
            waivers(candidate.id, meeting.id)[0]
          )
          if (block) fail(block)
        } else {
          if (meeting.status !== 'completed') fail('INTERVIEW_NOT_COMPLETED')
          if (meeting.stage_scope !== candidate.stage) fail('HISTORICAL_FEEDBACK_NOT_ALLOWED')
          if (currentFeedback(meeting.id)) fail('FEEDBACK_ALREADY_EXISTS')
        }
        const result = db
          .prepare(
            `
          INSERT INTO feedback(interview_id,reviewer_name,recorded_by_user_id,recommendation,reason,submitted_at,revision)
          VALUES (?,?,?,?,?,?,1)
        `
          )
          .run(
            meeting.id,
            payload.reviewer_name,
            user.id,
            payload.recommendation,
            payload.reason,
            now
          )
        return { feedbackId: Number(result.lastInsertRowid) }
      },
      ...(supplement
        ? {
            describe: (candidate, _after, payload) => {
              const waiver = waivers(candidate.id, payload.interview_id)[0]
              return {
                context: {
                  kind: 'post_advancement_supplement',
                  stageScope: waiver.stageScope,
                  waiverEventId: waiver.eventId
                }
              }
            }
          }
        : {})
    })
  }

  core.register('feedback.correct', {
    aggregate: 'candidate',
    mode: 'feedback',
    eventType: 'feedback_corrected',
    change: (candidate, payload) => {
      validateEvaluation(payload, true)
      if (typeof payload.correction_reason !== 'string' || !payload.correction_reason.trim())
        fail('CORRECTION_REASON_REQUIRED')
      if (
        !positiveId(payload.feedback_revision) ||
        payload.feedback_revision >= Number.MAX_SAFE_INTEGER
      )
        fail('INVALID_FEEDBACK_REVISION')
      const meeting = interview(candidate.id, payload.interview_id)
      if (meeting.status !== 'completed') fail('INTERVIEW_NOT_COMPLETED')
      const existing = currentFeedback(meeting.id)
      if (!existing) fail('FEEDBACK_NOT_FOUND')
      if (existing.revision !== payload.feedback_revision) fail('FEEDBACK_REVISION_CONFLICT')
      const values = evaluationFields.map((key) =>
        Object.hasOwn(payload, key) ? payload[key] : existing[key]
      )
      if (evaluationFields.every((key, index) => existing[key] === values[index])) fail('NO_CHANGE')
      const result = db
        .prepare(
          `
        UPDATE feedback SET reviewer_name=?,recommendation=?,reason=?,revision=revision+1
        WHERE id=? AND interview_id=? AND revision=?
      `
        )
        .run(...values, existing.id, meeting.id, payload.feedback_revision)
      if (result.changes !== 1) fail('FEEDBACK_REVISION_CONFLICT')
      return { feedbackId: existing.id }
    },
    describe: (_before, _after, payload) => ({
      reason: payload.correction_reason,
      context: {
        fromRevision: payload.feedback_revision,
        toRevision: payload.feedback_revision + 1
      }
    })
  })

  const supplementFacts = (candidate, meeting, evidence) => {
    const feedback = currentFeedback(meeting.id)
    const blockedReason = supplementBlock(candidate, meeting, feedback, evidence[0])
    const supplemented =
      feedback &&
      db
        .prepare(
          `
      SELECT id,occurred_at FROM business_events WHERE candidate_id=? AND interview_id=?
        AND feedback_id=? AND event_type='feedback_supplemented' ORDER BY aggregate_version LIMIT 1
    `
        )
        .get(candidate.id, meeting.id, feedback.id)
    return {
      interviewId: meeting.id,
      stageScope: meeting.stage_scope,
      canSupplement: blockedReason === null,
      blockedReason,
      waivers: evidence,
      historicalMissing: evidence.length > 0 && !feedback,
      feedbackId: feedback?.id ?? null,
      supplementEventId: supplemented?.id ?? null,
      supplementedAt: supplemented?.occurred_at ?? null
    }
  }

  return Object.freeze({
    execute: core.execute,
    byApplication: (context, id) => {
      auth(context)
      const candidate = application(id)
      return db
        .prepare(
          `
        SELECT f.*,i.stage_scope,EXISTS(SELECT 1 FROM business_events e
          WHERE e.feedback_id=f.id AND e.event_type='feedback_corrected') AS corrected
        FROM feedback f JOIN interviews i ON i.id=f.interview_id WHERE i.candidate_id=? ORDER BY f.id
      `
        )
        .all(id)
        .map((row) => ({
          ...row,
          corrected: Boolean(row.corrected),
          currentRound: row.stage_scope === candidate.stage
        }))
    },
    supplementEligibility: (context, candidateId, interviewId) => {
      auth(context)
      return supplementFacts(
        application(candidateId),
        interview(candidateId, interviewId),
        waivers(candidateId, interviewId)
      )
    },
    historicalMissing: (context, candidateId) => {
      auth(context)
      const candidate = application(candidateId)
      const byInterview = new Map()
      for (const evidence of waivers(candidateId)) {
        if (!byInterview.has(evidence.interviewId)) byInterview.set(evidence.interviewId, [])
        byInterview.get(evidence.interviewId).push(evidence)
      }
      return [...byInterview].map(([id, evidence]) =>
        supplementFacts(candidate, interview(candidateId, id), evidence)
      )
    },
    feedbackHistory: (context, candidateId, feedbackId) => {
      auth(context)
      application(candidateId)
      if (!positiveId(feedbackId)) fail('INVALID_ID')
      const subject = db
        .prepare(
          `
        SELECT i.stage_scope FROM feedback f JOIN interviews i ON i.id=f.interview_id
        WHERE f.id=? AND i.candidate_id=?
      `
        )
        .get(feedbackId, candidateId)
      if (!subject) fail('FEEDBACK_NOT_FOUND')
      return db
        .prepare(
          `
        SELECT e.id,e.event_type,e.actor_user_id,e.actor_name_snapshot,e.occurred_at,e.reason,
          e.aggregate_version,e.interview_id,e.feedback_id,e.old_values_json,e.new_values_json,e.context_json,
          (SELECT decision.id FROM business_events decision
           WHERE decision.candidate_id=e.candidate_id AND decision.event_type='stage_advanced'
             AND decision.aggregate_version<e.aggregate_version
             AND json_extract(decision.old_values_json,'$.stage')=?
           ORDER BY decision.aggregate_version DESC LIMIT 1) AS priorAdvancementEventId
        FROM business_events e WHERE e.candidate_id=? AND e.feedback_id=?
          AND e.event_type IN ('feedback_submitted','feedback_supplemented','feedback_corrected')
        ORDER BY e.aggregate_version
      `
        )
        .all(subject.stage_scope, candidateId, feedbackId)
        .map(({ old_values_json, new_values_json, context_json, ...event }) => ({
          ...event,
          before: JSON.parse(old_values_json),
          after: JSON.parse(new_values_json),
          context: JSON.parse(context_json)
        }))
    }
  })
}
