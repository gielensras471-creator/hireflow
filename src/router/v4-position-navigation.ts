import { nextTick, type InjectionKey } from 'vue'
import { positionSource } from './v3-navigation'
import { v3Session } from '../api/request-v3'

export const positionTabTitle: InjectionKey<(path: string, title: string) => void> = Symbol()

const origins = new Map<
  string,
  { id: number; owner: number; top: number; left: number; tableTop: number }
>()
export function positionLink(id: number, source: string) {
  return { name: 'position-detail', params: { id }, query: { from: positionSource(source) } }
}

export function rememberPosition(event: MouseEvent, source: string, id: number) {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const main = document.querySelector('.v3-content')
  const table = (event.currentTarget as HTMLElement | null)?.closest('.v3-table-scroll')
  origins.delete(source)
  if (origins.size >= 12) {
    const first = origins.keys().next().value
    if (first !== undefined) origins.delete(first)
  }
  origins.set(source, {
    id,
    owner: v3Session.version(),
    top: main?.scrollTop ?? 0,
    left: table?.scrollLeft ?? 0,
    tableTop: table?.scrollTop ?? 0
  })
}

export async function restorePosition(source: string) {
  const state = origins.get(source)
  if (!state) return
  origins.delete(source)
  await nextTick()
  if (state.owner !== v3Session.version()) return
  const opener = document.querySelector<HTMLElement>('[data-position-link="' + state.id + '"]')
  const main = document.querySelector('.v3-content')
  opener?.closest('.v3-table-scroll')?.scrollTo(state.left, state.tableTop)
  main?.scrollTo(0, state.top)
  opener?.focus({ preventScroll: true })
}
