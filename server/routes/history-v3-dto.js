const applicationState = {
  positionId: 'position_id',
  stage: 'stage',
  applicationStatus: 'application_status',
  offerStatus: 'offer_status',
  outcome: 'outcome',
  closedReason: 'closed_reason',
  closedAt: 'closed_at',
  version: 'version'
}
const positionState = {
  title: 'title',
  department: 'department',
  location: 'location',
  publishDate: 'publish_date',
  status: 'status',
  deletedAt: 'deleted_at',
  version: 'version'
}
const interviewState = {
  stageScope: 'stage_scope',
  status: 'status',
  scheduledAt: 'scheduled_at',
  completedAt: 'completed_at',
  cancelledAt: 'cancelled_at',
  version: 'version'
}
const feedbackState = {
  reviewerName: 'reviewer_name',
  recordedByUserId: 'recorded_by_user_id',
  recommendation: 'recommendation',
  reason: 'reason',
  submittedAt: 'submitted_at',
  revision: 'revision'
}
const applicationProfileFields = {
  name: 'name',
  education: 'education',
  school: 'school',
  phone: 'phone',
  email: 'email',
  owner: 'owner',
  skills: 'skills',
  experience: 'experience',
  note: 'note',
  appliedDate: 'applied_date'
}

const project = (row, fields) =>
  row === null
    ? null
    : Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, row[key]]))

const snapshots = (event) => {
  if (event.aggregateType === 'position') return positionState
  if (event.eventType.startsWith('interview_')) return interviewState
  if (event.eventType.startsWith('feedback_')) return feedbackState
  return applicationState
}

export const historyEventDto = (event) => {
  const fields = snapshots(event)
  const dto = {
    eventId: event.eventId,
    eventType: event.eventType,
    commandId: event.commandId,
    actorUserId: event.actorUserId,
    actorName: event.actorNameSnapshot,
    occurredAt: event.occurredAt,
    reason: event.reason,
    positionId: event.positionId,
    ...(event.aggregateType === 'position'
      ? { positionVersion: event.aggregateVersion }
      : {
          applicationId: event.candidateId,
          applicationVersion: event.aggregateVersion,
          interviewId: event.interviewId,
          feedbackId: event.feedbackId
        }),
    before: project(event.before, fields),
    after: project(event.after, fields)
  }
  if (event.eventType === 'candidate_updated') {
    // Show which profile fields changed without publishing the previous or current values.
    dto.changedFields = Object.entries(applicationProfileFields)
      .filter(([, key]) => event.before[key] !== event.after[key])
      .map(([name]) => name)
  }
  if (event.eventType === 'stage_advanced') {
    dto.kind = event.context.kind
    dto.missingFeedbackLinks = event.missingFeedbackLinks.map((link) => ({
      interviewId: link.interviewId,
      stageScope: link.stageScope,
      supplementEventId: link.supplementEventId,
      supplementedAt: link.supplementedAt,
      supplementActorUserId: link.supplementActorUserId,
      supplementActorName: link.supplementActorNameSnapshot
    }))
  }
  if (event.eventType === 'feedback_supplemented') {
    dto.waiverEventId = event.context.waiverEventId
    dto.stageScope = event.context.stageScope
  }
  if (event.eventType === 'feedback_corrected') {
    dto.priorDecisions = {
      advancementEventId: event.priorDecisions.advancementEventId,
      closureEventId: event.priorDecisions.closureEventId
    }
  }
  if (['hr_input', 'system_default'].includes(event.context?.reasonSource))
    dto.reasonSource = event.context.reasonSource
  return dto
}

export const historicalMissingDto = (record) => ({
  interviewId: record.interviewId,
  stageScope: record.stageScope,
  canSupplement: record.canSupplement,
  blockedReason: record.blockedReason,
  historicalMissing: record.historicalMissing,
  feedbackId: record.feedbackId,
  supplementEventId: record.supplementEventId,
  supplementedAt: record.supplementedAt,
  waivers: record.waivers.map((waiver) => ({
    interviewId: waiver.interviewId,
    stageScope: waiver.stageScope,
    eventId: waiver.eventId,
    occurredAt: waiver.occurredAt,
    reason: waiver.reason,
    toStage: waiver.toStage
  }))
})

const approved = (value, allowed) => (allowed.includes(value) ? value : null)
const stages = ['screening', 'first_interview', 'second_interview', 'offer']
const interviewStatuses = ['scheduled', 'completed', 'cancelled']
const archivedFacts = ({ entityType, raw, facts }) => {
  // DEV-03 archives these enum facts only. Dates, reasons and identity text from old JSON are unverified.
  if (entityType === 'candidates')
    return {
      raw: { stage: approved(raw?.stage, [...stages, 'rejected']) },
      facts: {
        stage: approved(facts?.stage, stages),
        applicationStatus: approved(facts?.application_status, ['closed']),
        outcome: approved(facts?.outcome, ['company_rejected']),
        offerStatus: null,
        closedAt: null,
        closedReason: null
      }
    }
  if (entityType === 'interviews')
    return {
      raw: { status: approved(raw?.status, interviewStatuses) },
      facts: {
        status: approved(facts?.status, interviewStatuses),
        stageScope: null,
        scheduledAt: null,
        completedAt: null,
        cancelledAt: null
      }
    }
  return {
    raw: { status: approved(raw?.status, ['open', 'closed']) },
    facts: {
      mappedPositionId:
        Number.isSafeInteger(facts?.mapped_position_id) && facts.mapped_position_id > 0
          ? facts.mapped_position_id
          : null
    }
  }
}

export const legacyRecordDto = (record) => ({
  sourceKey: record.sourceKey,
  entityType: record.entityType,
  legacyId: record.legacyId,
  mappingStatus: record.mappingStatus,
  mappedPositionId: record.mappedPositionId,
  importedAt: record.importedAt,
  historyStatus: record.historyStatus,
  hint: record.hint,
  ...archivedFacts(record)
})
