import type { Application } from './recruiting-v3'
export type OfferState = {
  applicationId: number
  stage: string
  applicationStatus: string
  offerStatus: string | null
  outcome: string | null
  closedReason: string | null
  closedAt: number | null
  version: number
}
export type Pending = { interviewId: number; stageScope: string; scheduledAt: number }
export type OfferAction = 'send' | 'accept' | 'decline' | 'confirmHire' | 'close'
export const offerActions: Record<OfferAction, string> = {
  send: '登记 Offer 已发送',
  accept: '登记候选人接受 Offer',
  decline: '登记候选人拒绝 Offer',
  confirmHire: 'HR 确认录用',
  close: '结束招聘'
}
export const outcomes: Record<string, string> = {
  company_rejected: '企业淘汰',
  candidate_withdrew: '候选人退出',
  hired: '已录用',
  offer_declined: 'Offer 被拒绝'
}
export const offerStatuses: Record<string, string> = {
  preparing: '准备中，尚未确认发送',
  sent: '已发送，等待候选人回应',
  accepted: '已接受，待 HR 确认录用',
  declined: '已拒绝，招聘已结束'
}
export const offerBlocks: Record<string, string> = {
  APPLICATION_CLOSED: '申请已结束，不能再次操作。',
  INVALID_OFFER_STAGE: '尚未进入 Offer 阶段。',
  INVALID_OFFER_STATUS: '当前 Offer 状态不允许该操作。',
  SCHEDULED_INTERVIEW_PENDING: '请先完成或取消待处理预约，填写原因也不能绕过。'
}
export type OfferPreflight = {
  application: OfferState
  pendingInterviews: Pending[]
  actions: Record<Exclude<OfferAction, 'close'>, { allowed: boolean; blockedReason: string | null }>
}
export type ClosurePreflight = {
  application: OfferState
  pendingInterviews: Pending[]
  allowed: boolean
  blockedReason: string | null
  allowedOutcomes: string[]
}
export type OfferContext = {
  profile: Application
  state: OfferState
  offer: OfferPreflight
  closure: ClosurePreflight
}
export type OfferEvent = {
  eventId: number
  eventType: string
  actorName: string
  actorUserId: number
  occurredAt: number
  reason: string | null
  reasonSource?: string
  before: OfferState
  after: OfferState
}
export const eventNames: Record<string, string> = {
  offer_sent: '登记 Offer 已发送',
  offer_accepted: '登记候选人接受',
  offer_declined: '拒绝 Offer 并结束招聘',
  candidate_hired: 'HR 确认录用',
  application_closed: '结束招聘'
}
export const offerAllowed = (c: OfferContext, a: OfferAction) =>
  a === 'close' ? c.closure.allowed : c.offer.actions[a].allowed
export const sameOfferIntent = (a: OfferContext, b: OfferContext) =>
  a.state.stage === b.state.stage &&
  a.state.applicationStatus === b.state.applicationStatus &&
  a.state.offerStatus === b.state.offerStatus &&
  a.state.outcome === b.state.outcome
export const actionPath = (id: number, a: OfferAction) =>
  '/applications/' +
  id +
  (a === 'close' ? '/close' : '/offer/' + (a === 'confirmHire' ? 'confirm-hire' : a))
