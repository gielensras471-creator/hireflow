export type Interview = {
  id: number
  applicationId: number
  candidateName: string
  positionId: number
  positionTitle: string
  stageScope: string
  applicationStage: string
  applicationStatus: string
  applicationVersion: number
  interviewVersion: number
  status: 'scheduled' | 'completed' | 'cancelled'
  scheduledAt: number
  scheduledLocal: string
  businessTimeZone: string
  startTimeReached: boolean
  reminder: string | null
  interviewerName: string
  note: string
  completedAt: number | null
  cancelledAt: number | null
  cancelReason: string | null
}
export type InterviewAction = 'schedule' | 'reschedule' | 'complete' | 'cancel'
export const interviewStatus = { scheduled: '已预约', completed: '已完成', cancelled: '已取消' }
export const interviewAction = {
  schedule: '安排面试',
  reschedule: '改期',
  complete: '确认完成',
  cancel: '取消面试'
}
export function canSchedule(
  application: { stage: string; applicationStatus: string },
  rows: Interview[]
) {
  return (
    application.applicationStatus === 'active' &&
    ['first_interview', 'second_interview'].includes(application.stage) &&
    !rows.some((row) => row.status === 'scheduled')
  )
}
export function shanghaiInput(value: string) {
  const local = value.length === 16 ? value + ':00' : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
    throw new Error('请输入完整的上海日期和时间。')
  const ms = Date.parse(local + '+08:00')
  if (
    !Number.isFinite(ms) ||
    ms < 0 ||
    new Date(ms + 8 * 3600000).toISOString().slice(0, 19) !== local
  )
    throw new Error('预约时间无效，请检查日期。')
  return local + '+08:00'
}
export function interviewQuery(query: Record<string, unknown>) {
  const result = new URLSearchParams()
  for (const key of ['applicationId', 'positionId', 'stageScope', 'status']) {
    if (typeof query[key] === 'string' && query[key]) result.set(key, String(query[key]))
  }
  const offset = Number(query.offset ?? 0)
  result.set('offset', String(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0))
  result.set('limit', '20')
  return result.toString()
}
