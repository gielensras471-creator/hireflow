export const candidateViews = ['board', 'table'] as const
export const interviewViews = ['day', 'week', 'month'] as const
export type CandidateView = (typeof candidateViews)[number]
export type InterviewView = (typeof interviewViews)[number]
export type WorkPreferences = { candidates: CandidateView; interviews: InterviewView }
type StorageSource = () => Pick<Storage, 'getItem' | 'setItem'>

export const preferenceDefaults: WorkPreferences = { candidates: 'board', interviews: 'week' }
export const preferenceKey = (mode: 'formal' | 'demo', id: number) =>
  'hireflow:v4:preferences:' + mode + ':' + id

export function createWorkPreferences(mode: 'formal' | 'demo', storage: StorageSource) {
  let active: { id: number; value: WorkPreferences } | undefined
  function read(id: number): WorkPreferences {
    if (!Number.isSafeInteger(id) || id < 1) return { ...preferenceDefaults }
    if (active?.id !== id) {
      const value = { ...preferenceDefaults }
      try {
        const parsed = JSON.parse(storage().getItem(preferenceKey(mode, id)) ?? 'null')
        if (parsed?.version === 1) {
          if (candidateViews.includes(parsed.candidates)) value.candidates = parsed.candidates
          if (interviewViews.includes(parsed.interviews)) value.interviews = parsed.interviews
        }
      } catch {
        // Invalid or unavailable local settings use system defaults.
      }
      active = { id, value }
    }
    return { ...active.value }
  }
  function save(id: number, value: WorkPreferences) {
    if (
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !candidateViews.includes(value.candidates) ||
      !interviewViews.includes(value.interviews)
    )
      return false
    active = { id, value: { ...value } }
    try {
      storage().setItem(preferenceKey(mode, id), JSON.stringify({ version: 1, ...value }))
      return true
    } catch {
      return false
    }
  }
  return {
    read,
    save,
    clear: () => {
      active = undefined
    }
  }
}

export const workPreferences = createWorkPreferences(
  import.meta.env?.MODE === 'v3-demo' ? 'demo' : 'formal',
  () => window.localStorage
)

// Authentication keeps the active credential in memory even if browser storage is denied.
export function optionalSessionStorage(source: () => Storage) {
  return {
    getItem(key: string) {
      try {
        return source().getItem(key)
      } catch {
        return null
      }
    },
    setItem(key: string, value: string) {
      try {
        source().setItem(key, value)
      } catch {
        /* Best effort. */
      }
    },
    removeItem(key: string) {
      try {
        source().removeItem(key)
      } catch {
        /* Best effort. */
      }
    }
  }
}
