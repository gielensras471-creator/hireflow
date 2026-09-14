/* GlobalState */
export interface GlobalState {
  isCollapse: boolean
  isDark: boolean
  breadcrumb: boolean
  primary: string
}

/* TabsMenuProps */
export interface TabsMenuProps {
  icon: string
  title: string
  path: string
  name: string
  close: boolean
  isKeepAlive: boolean
}

/* TabsState */
export interface TabsState {
  tabsMenuList: TabsMenuProps[]
}

/* KeepAliveState */
export interface KeepAliveState {
  keepAliveNames: string[]
}
