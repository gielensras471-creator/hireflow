import { shallowRef, type InjectionKey } from 'vue'
export function createEditorGate() {
  const current = shallowRef<symbol | null>(null)
  return {
    current,
    acquire() {
      if (current.value) return null
      const lease = Symbol('editor')
      current.value = lease
      return lease
    },
    owns(lease: symbol) {
      return current.value === lease
    },
    release(lease: symbol) {
      if (current.value === lease) current.value = null
    }
  }
}
export const editorGateKey: InjectionKey<ReturnType<typeof createEditorGate>> =
  Symbol('V3 editor gate')
