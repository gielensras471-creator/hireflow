import { Router } from 'express'
import { createInterviewService } from '../services/interview-service.js'
import { createFeedbackService } from '../services/feedback-service.js'
import { commandRequest, fail, integer } from './request-v3.js'

const interviewDto = (row) => ({
  id: row.id,
  applicationId: row.candidate_id,
  candidateName: row.candidate_name,
  positionId: row.position_id,
  positionTitle: row.position_title,
  stageScope: row.stage_scope,
  applicationStage: row.application_stage,
  applicationStatus: row.application_status,
  applicationVersion: row.application_version,
  interviewVersion: row.version,
  status: row.status,
  scheduledAt: row.scheduled_at,
  scheduledLocal: row.scheduled_local,
  businessTimeZone: row.business_time_zone,
  startTimeReached: row.start_time_reached,
  reminder: row.reminder,
  interviewerName: row.interviewer_name,
  note: row.note,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  cancelledAt: row.cancelled_at,
  cancelReason: row.cancel_reason
})

const feedbackSnapshot = (row) =>
  row === null
    ? null
    : {
        id: row.id,
        interviewId: row.interview_id,
        reviewerName: row.reviewer_name,
        recordedByUserId: row.recorded_by_user_id,
        recommendation: row.recommendation,
        reason: row.reason,
        submittedAt: row.submitted_at,
        revision: row.revision
      }
const feedbackDto = (row) => ({
  ...feedbackSnapshot(row),
  stageScope: row.stage_scope,
  corrected: row.corrected,
  currentRound: row.currentRound
})
const historyDto = (event) => ({
  eventId: event.id,
  eventType: event.event_type,
  actorUserId: event.actor_user_id,
  actorName: event.actor_name_snapshot,
  occurredAt: event.occurred_at,
  reason: event.reason,
  applicationVersion: event.aggregate_version,
  interviewId: event.interview_id,
  feedbackId: event.feedback_id,
  priorAdvancementEventId: event.priorAdvancementEventId,
  before: feedbackSnapshot(event.before),
  after: feedbackSnapshot(event.after),
  ...(event.event_type === 'feedback_supplemented'
    ? {
        waiverEventId: event.context.waiverEventId,
        stageScope: event.context.stageScope
      }
    : {})
})
const eligibilityDto = (facts) => ({
  interviewId: facts.interviewId,
  stageScope: facts.stageScope,
  canSupplement: facts.canSupplement,
  blockedReason: facts.blockedReason,
  historicalMissing: facts.historicalMissing,
  feedbackId: facts.feedbackId,
  supplementEventId: facts.supplementEventId,
  supplementedAt: facts.supplementedAt,
  waivers: facts.waivers.map(
    ({ interviewId, stageScope, eventId, occurredAt, reason, toStage }) => ({
      interviewId,
      stageScope,
      eventId,
      occurredAt,
      reason,
      toStage
    })
  )
})

const listOptions = (query) => {
  const allowed = ['applicationId', 'positionId', 'stageScope', 'status', 'limit', 'offset']
  if (
    Object.entries(query).some(
      ([key, value]) => !allowed.includes(key) || typeof value !== 'string'
    )
  )
    fail('INVALID_QUERY')
  const { applicationId, positionId, stageScope, status, limit = '50', offset = '0' } = query
  if (
    (stageScope !== undefined && !['first_interview', 'second_interview'].includes(stageScope)) ||
    (status !== undefined && !['scheduled', 'completed', 'cancelled'].includes(status))
  )
    fail('INVALID_QUERY')
  return {
    applicationId: applicationId === undefined ? undefined : integer(applicationId, 1),
    positionId: positionId === undefined ? undefined : integer(positionId, 1),
    stageScope,
    status,
    limit: integer(limit, 1, 100),
    offset: integer(offset, 0)
  }
}

const evaluation = {
  reviewerName: 'reviewer_name',
  recommendation: 'recommendation',
  reason: 'reason'
}
const interviewVersion = { interviewVersion: 'interview_version' }
const appointment = '/applications/:applicationId/interviews'
const meeting = appointment + '/:interviewId'
const evaluationPath = meeting + '/feedback'

export const createV3InterviewFeedbackRoutes = ({
  db,
  requireAuth,
  requireRecruiting,
  resolveActor
}) => {
  const router = Router()
  const interviews = createInterviewService({ db, resolveActor })
  const feedback = createFeedbackService({ db, resolveActor })
  const read = (handler) => [
    requireAuth,
    requireRecruiting,
    (req, res) => res.json(handler(req, res.locals.v3ActorContext))
  ]
  const write = (service, command, fields, created = false) => [
    requireAuth,
    requireRecruiting,
    (req, res) => {
      const request = commandRequest(req, command, fields, 'applicationId')
      if (req.params.interviewId !== undefined)
        request.payload.interview_id = integer(req.params.interviewId, 1)
      for (const [field, code] of [
        ['interview_version', 'INVALID_INTERVIEW_VERSION'],
        ['feedback_revision', 'INVALID_FEEDBACK_REVISION']
      ]) {
        if (!Object.values(fields).includes(field)) continue
        const version = request.payload[field]
        if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)
          fail(code)
      }
      const response = service.execute(res.locals.v3ActorContext, request)
      res.status(created && !response.replayed ? 201 : 200).json(response)
    }
  ]

  router.get(
    '/interviews',
    read((req, actor) => {
      const page = interviews.listPage(actor, listOptions(req.query))
      return { ...page, items: page.items.map(interviewDto) }
    })
  )
  router.get(
    '/interviews/:interviewId',
    read((req, actor) => interviewDto(interviews.detail(actor, integer(req.params.interviewId, 1))))
  )
  router.get(
    appointment,
    read((req, actor) =>
      interviews.byApplication(actor, integer(req.params.applicationId, 1)).map(interviewDto)
    )
  )
  router.post(
    appointment,
    write(
      interviews,
      'interview.schedule',
      {
        scheduledAt: 'scheduled_at',
        interviewerName: 'interviewer_name',
        note: 'note'
      },
      true
    )
  )
  router.post(
    meeting + '/reschedule',
    write(interviews, 'interview.reschedule', {
      ...interviewVersion,
      scheduledAt: 'scheduled_at'
    })
  )
  router.post(meeting + '/complete', write(interviews, 'interview.complete', interviewVersion))
  router.post(
    meeting + '/cancel',
    write(interviews, 'interview.cancel', { ...interviewVersion, reason: 'reason' })
  )

  router.get(
    '/applications/:applicationId/feedback',
    read((req, actor) =>
      feedback.byApplication(actor, integer(req.params.applicationId, 1)).map(feedbackDto)
    )
  )
  router.get(
    meeting + '/supplement-eligibility',
    read((req, actor) =>
      eligibilityDto(
        feedback.supplementEligibility(
          actor,
          integer(req.params.applicationId, 1),
          integer(req.params.interviewId, 1)
        )
      )
    )
  )
  router.get(
    '/applications/:applicationId/feedback/:feedbackId/history',
    read((req, actor) =>
      feedback
        .feedbackHistory(
          actor,
          integer(req.params.applicationId, 1),
          integer(req.params.feedbackId, 1)
        )
        .map(historyDto)
    )
  )
  router.post(evaluationPath, write(feedback, 'feedback.submit', evaluation, true))
  router.post(
    evaluationPath + '/supplement',
    write(feedback, 'feedback.supplement', evaluation, true)
  )
  router.post(
    evaluationPath + '/correct',
    write(feedback, 'feedback.correct', {
      ...evaluation,
      feedbackRevision: 'feedback_revision',
      correctionReason: 'correction_reason'
    })
  )
  return router
}
