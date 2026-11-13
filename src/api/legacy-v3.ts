export type LegacyKey = { sourceKey: string; entityType: string; legacyId: number }
export type LegacyRow = LegacyKey & {
  mappingStatus: string
  mappedPositionId: number | null
  importedAt: number
}
export type LegacyDetail = LegacyRow & {
  historyStatus: string
  hint: string
  raw: { stage?: string | null; status?: string | null }
  facts: Record<string, string | number | null>
}
export type LegacyPage = { items: LegacyRow[]; total: number; limit: number; offset: number }
export const entityLabels: Record<string, string> = {
  positions: '旧职位',
  candidates: '旧申请',
  interviews: '旧面试'
}
export const mappingLabels: Record<string, string> = {
  unique_match: '唯一匹配',
  no_match: '无匹配，待核实',
  ambiguous: '同名歧义，待核实',
  not_applicable: '不适用'
}
export const factLabels: Record<string, string> = {
  stage: '已确认阶段',
  applicationStatus: '已确认终止状态',
  outcome: '已确认结果',
  offerStatus: 'Offer 子状态',
  closedAt: '结束时间',
  closedReason: '结束原因',
  status: '旧面试状态',
  stageScope: '原面试轮次',
  scheduledAt: '预约开始时间',
  completedAt: '完成时间',
  cancelledAt: '取消时间',
  mappedPositionId: '映射职位 ID'
}
export function legacyFact(value: unknown): string {
  if (value === null || value === undefined) return '未知，待核实'
  const labels: Record<string, string> = {
    screening: '筛选',
    first_interview: '初面',
    second_interview: '复面',
    offer: 'Offer 阶段（子状态未知）',
    rejected: '旧版淘汰标记（原阶段未知）',
    closed: '已结束',
    company_rejected: '企业淘汰',
    open: '开放',
    scheduled: '已预约',
    completed: '已完成',
    cancelled: '已取消'
  }
  return typeof value === 'number' ? String(value) : labels[String(value)] ?? '未知，待核实'
}
