import { readV3 } from './request-v3'
export type Position = {
  id: number
  title: string
  department: string
  location: string
  description: string
  publishDate: string
  status: 'open' | 'closed'
  deletedAt: number | null
  version: number
  applicationRecords: number
  activeApplications: number
  legacyReferences: number
}
export type Application = {
  id: number
  name: string
  positionId: number
  positionTitle: string
  stage: string
  applicationStatus: 'active' | 'closed'
  outcome: string | null
  offerStatus: string | null
  owner: string
  version: number
  appliedDate: string
  education: string
  school: string
  phone: string
  email: string
  skills: string
  experience: string
  note: string
  closedReason: string | null
}
export type RecruitingRow = Position | Application
export type Page<T> = { items: T[]; total: number; limit: number; offset: number }
export const positionFields = [
  ['title', '职位名称'],
  ['department', '部门'],
  ['location', '工作地点'],
  ['publishDate', '发布日期'],
  ['description', '职位描述']
] as const
export const applicationFields = [
  ['name', '姓名'],
  ['owner', '业务负责人'],
  ['appliedDate', '申请日期'],
  ['phone', '电话'],
  ['email', '邮箱'],
  ['education', '学历'],
  ['school', '学校'],
  ['skills', '技能'],
  ['experience', '工作经历'],
  ['note', '备注']
] as const
export const labels: Record<string, string> = {
  screening: '筛选',
  first_interview: '初面',
  second_interview: '复面',
  offer: 'Offer',
  active: '进行中',
  closed: '已结束',
  open: '开放',
  preparing: '准备中',
  sent: '已发送',
  accepted: '已接受，待 HR 确认',
  declined: '已拒绝',
  hired: '已录用',
  company_rejected: '企业淘汰',
  candidate_withdrew: '候选人退出',
  rejected: '企业淘汰',
  withdrawn: '候选人退出',
  offer_declined: 'Offer 被拒'
}
export const label = (value: string | null | undefined) =>
  value ? (Object.hasOwn(labels, value) ? labels[value] : '未知，待核实') : '—'
export function pageQuery(query: Record<string, unknown>, positions: boolean) {
  const values = new URLSearchParams()
  const allowed = positions ? ['q', 'status'] : ['q', 'positionId', 'stage', 'applicationStatus']
  for (const key of allowed) {
    if (typeof query[key] === 'string' && query[key]) values.set(key, String(query[key]))
  }
  const offset = Number(query.offset ?? 0)
  values.set('offset', String(Number.isSafeInteger(offset) && offset >= 0 ? offset : 0))
  values.set('limit', '20')
  return values.toString()
}
export const detail = (resource: string, id: number) =>
  readV3<RecruitingRow>('/' + resource + '/' + id)

export const applicationOutcomeText = (row: Pick<Application, 'applicationStatus' | 'outcome'>) =>
  row.outcome
    ? label(row.outcome)
    : row.outcome === null && row.applicationStatus === 'active'
      ? '尚未结束'
      : '未记录结束结果'
export const applicationOfferText = (
  row: Pick<Application, 'stage' | 'applicationStatus' | 'offerStatus'>
) =>
  row.offerStatus
    ? row.offerStatus === 'accepted' && row.applicationStatus === 'closed'
      ? '已接受（历史事实）'
      : label(row.offerStatus)
    : row.offerStatus === null &&
        ['screening', 'first_interview', 'second_interview'].includes(row.stage)
      ? '未进入 Offer'
      : '未记录 Offer 状态'
