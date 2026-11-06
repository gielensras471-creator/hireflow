export const v3Sections = [
  { path: '/dashboard', name: 'dashboard', title: '工作台' },
  { path: '/positions', name: 'positions', title: '职位管理' },
  { path: '/candidates', name: 'candidates', title: '候选人管理' },
  { path: '/interviews', name: 'interviews', title: '面试管理' }
] as const

export function tabInfo(path: string) {
  const section = v3Sections.find((item) => item.path === path)
  if (section) return { key: section.path, title: section.title }
  if (path === '/profile') return { key: path, title: '个人中心' }
  const id = /^\/candidates\/([1-9]\d*)$/.exec(path)?.[1]
  if (id && Number.isSafeInteger(Number(id))) return { key: path, title: '申请 #' + id }
  return null
}

export function safeReturn(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.includes(String.fromCharCode(92)) ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return '/dashboard'
  return tabInfo(value.split(/[?#]/, 1)[0]) ? value : '/dashboard'
}

export type V3Tab = { key: string; title: string; target: string }

export function visit(tabs: V3Tab[], path: string, target: string): V3Tab[] {
  const tab = tabInfo(path)
  return tab ? [{ ...tab, target }, ...tabs.filter(({ key }) => key !== tab.key)] : tabs
}

export function visibleTabs(tabs: V3Tab[], max: number) {
  return { visible: tabs.slice(0, max), overflow: tabs.slice(max) }
}

export function shellTier(width: number) {
  if (width >= 1280) return { name: 'desktop', limit: 5, sidebar: 230 }
  if (width >= 960) return { name: 'compact', limit: 3, sidebar: 72 }
  return { name: 'mobile', limit: 1, sidebar: 0 }
}

export function canLeave(dirty: boolean, confirm: () => boolean) {
  return !dirty || confirm()
}
