import type { Application } from './recruiting-v3'
import type { Interview } from './interview-v3'
export const recommendations = {
  recommend: '推荐通过',
  not_recommend: '不推荐通过',
  undecided: '暂不确定'
} as const
export type Recommendation = keyof typeof recommendations
export type FeedbackSnapshot = {
  id: number
  interviewId: number
  reviewerName: string
  recordedByUserId: number
  recommendation: Recommendation
  reason: string
  submittedAt: number
  revision: number
}
export type FeedbackRecord = FeedbackSnapshot & {
  stageScope: string
  corrected: boolean
  currentRound: boolean
}
export type Eligibility = {
  interviewId: number
  stageScope: string
  canSupplement: boolean
  blockedReason: string | null
  historicalMissing: boolean
  feedbackId: number | null
  supplementEventId: number | null
  supplementedAt: number | null
  waivers: {
    interviewId: number
    stageScope: string
    eventId: number
    occurredAt: number
    reason: string
    toStage: string
  }[]
}
export type FeedbackEvent = {
  eventId: number
  eventType: string
  actorUserId: number
  actorName: string
  occurredAt: number
  reason: string | null
  applicationVersion: number
  interviewId: number
  feedbackId: number
  priorAdvancementEventId: number | null
  waiverEventId?: number
  before: FeedbackSnapshot | null
  after: FeedbackSnapshot | null
}
export type FeedbackAction = 'submit' | 'supplement' | 'correct'
export const feedbackActions = {
  submit: '填写面评',
  supplement: '补录历史面评',
  correct: '更正面评'
}
export function feedbackAllowed(
  action: FeedbackAction,
  app: Application,
  meeting: Interview,
  feedback: FeedbackRecord | null,
  facts: Eligibility
) {
  if (meeting.status !== 'completed') return false
  if (action === 'correct') return !!feedback
  if (app.applicationStatus !== 'active' || feedback) return false
  return action === 'supplement' ? facts.canSupplement === true : meeting.stageScope === app.stage
}
export const blockedMessages: Record<string, string> = {
  APPLICATION_CLOSED: '申请已结束，不能新增或补录缺失面评。',
  INTERVIEW_NOT_COMPLETED: '面试尚未完成，不能提交面评。',
  NOT_PAST_INTERVIEW_ROUND: '当前轮次应使用首次提交入口。',
  FEEDBACK_ALREADY_EXISTS: '已有当前有效面评，可查看或有痕更正。',
  HISTORICAL_WAIVER_REQUIRED: '没有真实晋级豁免证据，不能补录历史面评。'
}
export function feedbackTime(ms: number) {
  return (
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).format(ms) + '（上海）'
  )
}
