import type { Page, Position } from './recruiting-v3'

export const recruitingStages = [
  'screening',
  'first_interview',
  'second_interview',
  'offer'
] as const

export function listParams(
  query: Record<string, unknown>,
  positions: boolean,
  limit: number,
  offset: number
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const keys = positions ? ['q', 'status'] : ['q', 'positionId', 'stage', 'applicationStatus']
  for (const key of keys) {
    const value = query[key]
    if (typeof value === 'string' && value && !(key === 'applicationStatus' && value === 'all'))
      params.set(key, value)
  }
  return params
}

export function validOffset(raw: unknown, limit: number) {
  const offset = typeof raw === 'string' ? Number(raw) : 0
  return Number.isSafeInteger(offset) && offset >= 0 ? Math.floor(offset / limit) * limit : 0
}

export function availableOffset(total: number, offset: number, limit: number) {
  return Math.min(offset, Math.floor(Math.max(0, total - 1) / limit) * limit)
}

const changed = '记录在读取期间发生变化，请刷新后重试。'

export function verifyPage<T extends { id: number }>(
  page: Page<T>,
  offset: number,
  limit: number,
  previousTotal?: number,
  previousId = 0
) {
  if (
    page.offset !== offset ||
    page.limit !== limit ||
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    (previousTotal !== undefined && previousTotal !== page.total) ||
    page.items.length !== Math.min(limit, Math.max(0, page.total - offset)) ||
    page.items.some(
      (row, index) =>
        !Number.isSafeInteger(row.id) ||
        row.id <= (index > 0 ? page.items[index - 1].id : previousId)
    )
  )
    throw new Error(changed)
}

export async function collectPositions(
  fetchPage: (offset: number, limit: number) => Promise<Page<Position>>,
  stillCurrent: () => boolean
) {
  const limit = 100
  const budget = 300
  async function scan() {
    const rows: Position[] = []
    let total: number | undefined
    do {
      if (!stillCurrent()) throw new Error('查询已更新。')
      const response = await fetchPage(rows.length, limit)
      verifyPage(response, rows.length, limit, total, rows.at(-1)?.id)
      total = response.total
      if (total > budget) throw new Error('匹配职位超过 300 条，无法验证完整排序。')
      rows.push(...response.items)
    } while (rows.length < total)
    return rows
  }

  const first = await scan()
  if (first.length <= limit) return first
  const second = await scan()
  if (
    first.length !== second.length ||
    second.some((row, index) => {
      const prior = first[index]
      return (
        row.id !== prior.id ||
        row.version !== prior.version ||
        row.publishDate !== prior.publishDate ||
        row.status !== prior.status ||
        row.deletedAt !== prior.deletedAt
      )
    })
  )
    throw new Error(changed)
  return second
}

export function byPublishDate(rows: Position[]) {
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
    const millis = Date.parse(value)
    return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value
      ? value
      : ''
  }
  return rows
    .map((row) => ({ row, date: date(row.publishDate) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.row.id - b.row.id)
    .map(({ row }) => row)
}
