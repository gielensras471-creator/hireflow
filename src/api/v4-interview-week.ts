import type { Interview } from './interview-v3'
import type { Page } from './recruiting-v3'

export const dayMs = 86_400_000
const shanghaiOffset = 8 * 3_600_000
export const calendarHourHeight = 64
export const calendarCardHeight = 56
export const calendarStackOffset = 4
export const weekPageLimit = 100
export const weekPageBudget = 12
export type CalendarMode = 'day' | 'week' | 'month'

export function shanghaiDay(time: number) {
  return new Date(time + shanghaiOffset).toISOString().slice(0, 10)
}

export function shanghaiWeek(time: number) {
  const day = Math.floor((time + shanghaiOffset) / dayMs) * dayMs
  const weekday = new Date(day).getUTCDay()
  return day - shanghaiOffset - ((weekday + 6) % 7) * dayMs
}

function midnight(time: number) {
  return Math.floor((time + shanghaiOffset) / dayMs) * dayMs - shanghaiOffset
}

export function calendarRange(time: number, mode: CalendarMode) {
  if (mode === 'day') return { start: midnight(time), end: midnight(time) + dayMs }
  if (mode === 'week') return { start: shanghaiWeek(time), end: shanghaiWeek(time) + 7 * dayMs }
  const date = new Date(time + shanghaiOffset)
  const first = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - shanghaiOffset
  const last = shiftCalendar(first, 'month', 1) - dayMs
  return { start: shanghaiWeek(first), end: shanghaiWeek(last) + 7 * dayMs }
}

export function shiftCalendar(time: number, mode: CalendarMode, direction: number) {
  if (mode !== 'month') return time + direction * (mode === 'week' ? 7 : 1) * dayMs
  const date = new Date(time + shanghaiOffset)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + direction
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  return Date.UTC(year, month, day) - shanghaiOffset
}

export function weekGroups(rows: Interview[], start: number, length = 7) {
  const days: { top: number; rows: Interview[] }[][] = Array.from({ length }, () => [])
  for (const row of rows) {
    const day = Math.floor((row.scheduledAt - start) / dayMs)
    if (day < 0 || day >= length) continue
    const top = ((row.scheduledAt - start - day * dayMs) / 3_600_000) * calendarHourHeight
    const group = days[day].at(-1)
    if (group && top < group.top + calendarCardHeight + calendarStackOffset + 3)
      group.rows.push(row)
    else days[day].push({ top, rows: [row] })
  }
  return days
}

export function createWeekReader(start: number, budget = weekPageBudget) {
  return createCalendarReader(start, start + 7 * dayMs, budget)
}

export function createCalendarReader(start: number, end: number, budget = weekPageBudget) {
  const seen = new Set<number>()
  const rows: Interview[] = []
  let last: Interview | undefined
  let total: number | undefined
  let offset = 0
  return {
    get offset() {
      return offset
    },
    accept(page: Page<Interview>) {
      const fail = () => ({ state: 'inconsistent' as const, rows: [...rows] })
      if (
        page.offset !== offset ||
        page.limit !== weekPageLimit ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length !== Math.max(0, Math.min(page.total - offset, weekPageLimit)) ||
        (total !== undefined && total !== page.total)
      )
        return fail()
      const pageIds = new Set<number>()
      let previous = last
      for (const row of page.items) {
        if (
          !Number.isSafeInteger(row.id) ||
          row.id < 1 ||
          !Number.isSafeInteger(row.scheduledAt) ||
          seen.has(row.id) ||
          pageIds.has(row.id) ||
          (previous &&
            (row.scheduledAt < previous.scheduledAt ||
              (row.scheduledAt === previous.scheduledAt && row.id <= previous.id)))
        )
          return fail()
        pageIds.add(row.id)
        previous = row
      }
      pageIds.forEach((id) => seen.add(id))
      rows.push(...page.items.filter((row) => row.scheduledAt >= start && row.scheduledAt < end))
      total = page.total
      last = previous
      offset += page.items.length
      const state: 'complete' | 'budget' | 'reading' =
        offset >= total || (last && last.scheduledAt >= end)
          ? 'complete'
          : offset >= budget * weekPageLimit
            ? 'budget'
            : 'reading'
      return { state, rows: [...rows] }
    }
  }
}
