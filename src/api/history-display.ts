export type HistoricalEvent = { eventId: number; occurredAt: number }
export function sortableHistory(events: HistoricalEvent[]) {
  return events.every(
    (e) => Number.isSafeInteger(e.eventId) && e.eventId > 0 && Number.isSafeInteger(e.occurredAt)
  )
}
export function orderHistory<T extends HistoricalEvent>(events: T[]): T[] {
  return sortableHistory(events)
    ? [...events].sort((a, b) => b.occurredAt - a.occurredAt || b.eventId - a.eventId)
    : [...events]
}
export function historyCaption(events: HistoricalEvent[]) {
  return sortableHistory(events)
    ? '本来源已读取完整事件列表；默认最多显示本组最近三条，不是全局最新三条。'
    : '已加载历史摘要：排序字段未核实，不宣称最近三条。'
}
