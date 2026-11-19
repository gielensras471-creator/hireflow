import { ref } from 'vue'
import { canLeave } from './v3-navigation'

// A V3 form registers its unsaved state for the duration of its route.
export const v3DraftDirty = ref(false)
export const v3UncertainWrite = ref(false)
export const confirmV3Leave = () =>
  canLeave(v3DraftDirty.value, () =>
    window.confirm(
      v3UncertainWrite.value
        ? '提交结果尚未确定，服务器可能已保存。离开后请先查询记录，避免再次创建。确定离开吗？'
        : '有未保存的更改，确定离开吗？'
    )
  )

window.addEventListener('beforeunload', (event) => {
  if (v3DraftDirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
})
