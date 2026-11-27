import { advanceBlocks, canAdvance, type Preflight } from './advancement-v3'
import { offerActions, type OfferAction, type OfferContext } from './offer-v3'
import { label, applicationOutcomeText, type Application } from './recruiting-v3'
import type { HistoricalEvent } from './history-display'

export function currentTask(
  application: Application,
  decision: Preflight | null,
  offer: OfferContext | null
) {
  if (application.applicationStatus === 'closed')
    return {
      title: '申请已结束 · ' + applicationOutcomeText(application),
      detail: '可核实真实历史。已有面评的更正资格仍由面评模块检查。',
      target: 'history',
      action: '查看真实历史'
    } as const
  if (application.stage === 'offer') {
    if (!offer || offer.state.version !== application.version)
      return {
        title: '等待核验 Offer 操作资格',
        detail: '实时资格由 Offer 与结案模块提供。',
        target: 'offer',
        action: '前往 Offer 与结案'
      } as const
    const action = (['send', 'accept', 'confirmHire'] as const).find(
      (name) => offer.offer.actions[name].allowed
    )
    return {
      title: action ? offerActions[action as OfferAction] : '核对 Offer 与结案状态',
      detail: '仅登记已经发生的事实。候选人接受 Offer 后，仍须 HR 独立确认录用。',
      target: 'offer',
      action: '前往 Offer 与结案'
    } as const
  }
  if (
    !decision ||
    decision.version !== application.version ||
    decision.fromStage !== application.stage
  )
    return {
      title: '当前任务资格待核验',
      detail: '可查看目前的招聘阶段与模块读取状态。',
      target: 'decision',
      action: '查看 HR 决策'
    } as const
  if (decision.scheduled.length)
    return {
      title: label(application.stage) + '有待处理预约',
      detail: advanceBlocks.SCHEDULED_INTERVIEW_PENDING,
      target: 'interviews',
      action: '前往面试与面评'
    } as const
  if (decision.missingInterviewIds.length)
    return {
      title: label(application.stage) + '已完成，尚有面评待提交',
      detail:
        '缺评面试 ' +
        decision.missingInterviewIds.map((id) => '#' + id).join('、') +
        '。可先提交面评，或由 HR 核实例外资格。',
      target: 'interviews',
      action: '前往面试与面评'
    } as const
  if (decision.reasonType === 'skip_evaluation')
    return {
      title: '本轮尚无已完成面试',
      detail: '可核实是否需要安排面试。选择跳过本轮评估时，须在 HR 决策中填写理由。',
      target: 'interviews',
      action: '前往面试与面评'
    } as const
  return {
    title: canAdvance(decision) ? '待 HR 决定是否晋级至' + label(decision.toStage) : '当前晋级受限',
    detail: decision.blockedReason
      ? advanceBlocks[decision.blockedReason] ?? '请核实服务器资格。'
      : '阶段推进由 HR 独立确认。',
    target: 'decision',
    action: '前往 HR 决策'
  } as const
}

export type HistoryCursor = { occurredAt: number; eventId: number }

export function appendEvents<T extends HistoricalEvent>(existing: T[], page: T[]) {
  const merged = new Map(existing.map((event) => [event.eventId, event]))
  for (const event of page) if (!merged.has(event.eventId)) merged.set(event.eventId, event)
  return [...merged.values()]
}
