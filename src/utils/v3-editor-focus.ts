import { nextTick, type VNode } from 'vue'

export function useEditorFocus(section: string) {
  let trigger: HTMLElement | null = null
  let returnHeading: HTMLElement | null = null

  return {
    remember(event: MouseEvent) {
      trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
      returnHeading =
        trigger?.closest(section)?.querySelector<HTMLElement>('header h1, header h2') ?? null
    },
    enter(vnode: VNode) {
      const active = document.activeElement
      if (active !== document.body && active !== trigger) return
      const heading = (vnode.el as HTMLElement | null)?.querySelector<HTMLElement>('h2, h3')
      if (heading) {
        heading.tabIndex = -1
        heading.focus()
      }
    },
    async restore() {
      const opener = trigger
      const heading = returnHeading
      trigger = null
      returnHeading = null
      await nextTick()
      if (document.activeElement !== document.body) return
      if (opener?.isConnected) opener.focus()
      if (document.activeElement === document.body && heading?.isConnected) {
        heading.tabIndex = -1
        heading.focus()
      }
    },
    clear() {
      trigger = null
      returnHeading = null
    }
  }
}
