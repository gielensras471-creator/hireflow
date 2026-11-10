export const workLabels = {
  screening: '待筛选',
  scheduling: '待安排面试',
  due: '预约到时待确认',
  feedback: '待提交面评',
  decision: '待 HR 决策',
  offer: 'Offer 待处理'
} as const
export type WorkType = keyof typeof workLabels
export const offerLabels = {
  preparing: '待发送',
  sent: '待候选人回应',
  accepted: '待 HR 确认录用'
} as const
export const unitLabel = (unit: string) =>
  ({ position_record: '个职位记录', application_record: '条申请记录', interview_record: '场面试' })[
    unit
  ] ?? unit
export type Metric = { count: number; unit: string }
export type Summary = {
  now: number
  timezone: string
  openPositions: Metric & { softDeletedOpen: number }
  activeApplications: Metric
  todayInterviews: Metric
  applicationTotals: { total: number; active: number; closed: number; hired: number; unit: string }
  work: Record<WorkType, Metric>
  offerByStatus: Record<keyof typeof offerLabels, number>
}
export type WorkRow = {
  applicationId: number
  positionId: number
  stage: string
  applicationStatus: string
  offerStatus: string | null
  interviewId: number | null
  stageScope?: string
  interviewStatus?: 'scheduled' | 'completed' | 'cancelled'
  scheduledAt?: number
  completedAt?: number
  cancelledAt?: number
  businessTime?: number
  businessTimeKind?: string
  hint: string | null
  due?: boolean
}
export type WorkPage = {
  items: WorkRow[]
  total: number
  unit: string
  limit: number
  offset: number
}
export type Today = WorkPage & {
  start: number
  end: number
  timezone: string
  byStatus: { scheduled: number; completed: number; cancelled: number }
}
export const timeKinds: Record<string, string> = {
  application_created_at: '申请创建时间（不是进入阶段时间）',
  interview_completed_at: '面试实际完成时间',
  interview_scheduled_at: '面试预约开始时间'
}
export function workPath(type: WorkType, status: string, offset: number) {
  return (
    '/dashboard/' +
    (type === 'offer' && status ? 'offer-work-items/' + status : 'work-items/' + type) +
    '?limit=10&offset=' +
    offset
  )
}
