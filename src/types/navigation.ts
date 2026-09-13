export interface AppMenuItem {
  path: string
  meta: {
    title: string
    icon?: string
    isLink?: boolean
  }
  children?: AppMenuItem[]
}
