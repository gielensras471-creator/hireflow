export const stages = ['screening', 'first_interview', 'second_interview', 'offer'] as const
export type RoundFact = {
  interviewId: number
  stageScope: string
  status: string
  scheduledAt: number
  completedAt: number | null
  cancelledAt: number | null
  feedbackId: number | null
  recommendation: string | null
}
export type Preflight = {
  applicationId: number
  version: number
  fromStage: string
  toStage: string | null
  canAdvance: boolean
  canAdvanceWithReason: boolean
  blockedReason: string | null
  reasonRequired: boolean
  reasonType: string | null
  scheduled: RoundFact[]
  completed: RoundFact[]
  cancelled: RoundFact[]
  completedCount: number
  missingInterviewIds: number[]
}
export type AdvancementEvent = {
  eventId: number
  eventType: string
  actorUserId: number
  actorName: string
  occurredAt: number
  reason: string | null
  fromStage: string
  toStage: string
  kind: string
  missingInterviews: { interviewId: number; stageScope: string }[]
}
export const kinds: Record<string, string> = {
  normal: '正常晋级',
  missing_feedback: '带缺评说明推进',
  skip_evaluation: '跳过本轮评估'
}
export const advanceBlocks: Record<string, string> = {
  APPLICATION_CLOSED: '该申请的招聘已结束，不能继续晋级。',
  NO_NEXT_STAGE: '已到 Offer 阶段，没有下一招聘阶段。',
  SCHEDULED_INTERVIEW_PENDING: '当前轮次还有预约，请先完成或取消；填写原因也不能绕过。'
}
export const canAdvance = (p: Preflight) =>
  !p.blockedReason && !p.scheduled.length && !!p.toStage && (p.canAdvance || p.canAdvanceWithReason)
export const sameTransition = (original: Preflight, latest: Preflight) =>
  original.fromStage === latest.fromStage && original.toStage === latest.toStage
// Compare every public preflight fact, independently of JSON object key ordering.
export function preflightSignature(p: Preflight) {
  const round = (r: RoundFact) => [
    r.interviewId,
    r.stageScope,
    r.status,
    r.scheduledAt,
    r.completedAt,
    r.cancelledAt,
    r.feedbackId,
    r.recommendation
  ]
  return JSON.stringify([
    p.applicationId,
    p.version,
    p.fromStage,
    p.toStage,
    p.canAdvance,
    p.canAdvanceWithReason,
    p.blockedReason,
    p.reasonRequired,
    p.reasonType,
    p.scheduled.map(round),
    p.completed.map(round),
    p.cancelled.map(round),
    p.completedCount,
    p.missingInterviewIds
  ])
}
