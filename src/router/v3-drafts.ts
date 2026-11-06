import { ref } from 'vue'
import { canLeave } from './v3-navigation'

// A V3 form registers its unsaved state for the duration of its route.
export const v3DraftDirty = ref(false)
export const confirmV3Leave = () =>
  canLeave(v3DraftDirty.value, () => window.confirm('有未保存的更改，确定离开吗？'))
