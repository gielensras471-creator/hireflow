import { Router } from 'express'
import { createAdvancementService } from '../services/advancement-service.js'
import { createOfferService } from '../services/offer-service.js'
import { commandRequest, integer } from './request-v3.js'

const stateDto = (row) => ({
  applicationId: row.id,
  stage: row.stage,
  applicationStatus: row.application_status,
  offerStatus: row.offer_status,
  outcome: row.outcome,
  closedReason: row.closed_reason,
  closedAt: row.closed_at,
  version: row.version
})

const appointmentDto = (row) => ({
  interviewId: row.id,
  stageScope: row.stage_scope,
  scheduledAt: row.scheduled_at
})
const roundInterviewDto = (row) => ({
  ...appointmentDto(row),
  status: row.status,
  completedAt: row.completed_at,
  cancelledAt: row.cancelled_at,
  feedbackId: row.feedback_id,
  recommendation: row.recommendation
})

const advancementPreflightDto = (result) => ({
  applicationId: result.candidateId,
  version: result.version,
  fromStage: result.fromStage,
  toStage: result.toStage,
  canAdvance: result.canAdvance,
  canAdvanceWithReason: result.canAdvanceWithReason,
  blockedReason: result.blockedReason,
  reasonRequired: result.reasonType !== null,
  reasonType: result.reasonType,
  scheduled: result.scheduled.map(roundInterviewDto),
  completed: result.completed.map(roundInterviewDto),
  cancelled: result.cancelled.map(roundInterviewDto),
  completedCount: result.completedCount,
  missingInterviewIds: result.missingInterviewIds
})

const actions = [
  { path: 'send', action: 'send', command: 'offer.send', fields: {} },
  { path: 'accept', action: 'accept', command: 'offer.accept', fields: {} },
  { path: 'decline', action: 'decline', command: 'offer.decline', fields: { reason: 'reason' } },
  {
    path: 'confirm-hire',
    action: 'confirmHire',
    command: 'offer.confirmHire',
    fields: { reason: 'reason' }
  }
]
const offerPreflightDto = (result) => ({
  application: stateDto(result.candidate),
  pendingInterviews: result.pendingInterviews.map(appointmentDto),
  actions: Object.fromEntries(
    actions.map(({ action, command }) => {
      const { allowed, blockedReason } = result.actions[command]
      return [action, { allowed, blockedReason }]
    })
  )
})
const closurePreflightDto = (result) => ({
  application: stateDto(result.candidate),
  allowed: result.allowed,
  blockedReason: result.blockedReason,
  pendingInterviews: result.pendingInterviews.map(appointmentDto),
  allowedOutcomes: result.allowedOutcomes
})

const auditDto = (event) => ({
  eventId: event.id,
  eventType: event.event_type,
  commandId: event.command_id,
  actorUserId: event.actor_user_id,
  actorName: event.actor_name_snapshot,
  occurredAt: event.occurred_at,
  reason: event.reason,
  applicationVersion: event.aggregate_version
})
const advancementHistoryDto = (event) => {
  const before = stateDto(JSON.parse(event.old_values_json))
  const after = stateDto(JSON.parse(event.new_values_json))
  return {
    ...auditDto(event),
    before,
    after,
    fromStage: before.stage,
    toStage: after.stage,
    kind: event.context.kind,
    missingInterviews: event.missing.map(({ interview_id, stage_scope }) => ({
      interviewId: interview_id,
      stageScope: stage_scope
    }))
  }
}
const offerHistoryDto = (event) => ({
  ...auditDto(event),
  before: stateDto(event.before),
  after: stateDto(event.after),
  ...(event.context.reasonSource ? { reasonSource: event.context.reasonSource } : {})
})

const application = '/applications/:applicationId'

export const createV3DecisionRoutes = ({ db, requireAuth, requireRecruiting, resolveActor }) => {
  const router = Router()
  const advancement = createAdvancementService({ db, resolveActor })
  const offer = createOfferService({ db, resolveActor })
  const read = (method, dto) => [
    requireAuth,
    requireRecruiting,
    (req, res) =>
      res.json(dto(method(res.locals.v3ActorContext, integer(req.params.applicationId, 1))))
  ]
  const write = (service, command, fields) => [
    requireAuth,
    requireRecruiting,
    (req, res) =>
      res.json(
        service.execute(
          res.locals.v3ActorContext,
          commandRequest(req, command, fields, 'applicationId')
        )
      )
  ]

  router.get(
    application + '/advance/preflight',
    read(advancement.preflight, advancementPreflightDto)
  )
  router.post(
    application + '/advance',
    write(advancement, 'application.advance', {
      reason: 'reason',
      targetStage: 'target_stage'
    })
  )
  router.get(
    application + '/advancement/history',
    read(advancement.history, (events) => events.map(advancementHistoryDto))
  )

  router.get(application + '/offer', read(offer.offerDetail, stateDto))
  router.get(application + '/offer/preflight', read(offer.offerPreflight, offerPreflightDto))
  for (const { path, command, fields } of actions)
    router.post(application + '/offer/' + path, write(offer, command, fields))
  router.get(
    application + '/offer/history',
    read(offer.history, (events) => events.map(offerHistoryDto))
  )

  router.get(application + '/closure/preflight', read(offer.closurePreflight, closurePreflightDto))
  router.post(
    application + '/close',
    write(offer, 'application.close', { outcome: 'outcome', reason: 'reason' })
  )

  return router
}
