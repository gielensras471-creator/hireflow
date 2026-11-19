import { reactive } from 'vue'

export type V3User = { id: number; username: string; name: string; role: string }
export type Credentials = { username: string; password: string; remember: boolean }
type Token = { token: string; expiresAt: number }
type StoredToken = Token & { remember: boolean }
type Status = 'anonymous' | 'checking' | 'ready' | 'forbidden' | 'unavailable'
type Transport = {
  login(credentials: Credentials): Promise<Token>
  me(token: string): Promise<V3User>
}
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const v3SessionKey = 'hireflow_v3_session'
export const v3TemporaryKey = 'hireflow_v3_session_temp'
export const v3TabsKey = 'hireflow_v3_tabs'
export const isRecruiter = (role: string) => ['招聘管理员', 'hr', 'admin'].includes(role)

export class V3Error extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export function createV3Session(
  transport: Transport,
  local: SessionStorage,
  temporary: SessionStorage
) {
  function read(storage: SessionStorage, key: string, remember: boolean): StoredToken | null {
    try {
      const value = JSON.parse(storage.getItem(key) ?? 'null')
      if (typeof value?.token === 'string' && value.token && Number.isFinite(value.expiresAt)) {
        return { token: value.token, expiresAt: value.expiresAt, remember }
      }
    } catch {
      // Invalid browser storage is treated as a missing session.
    }
    return null
  }

  const initial = read(temporary, v3TemporaryKey, false) ?? read(local, v3SessionKey, true)
  const state = reactive<{ status: Status; user: V3User | null; expired: boolean }>({
    status: initial ? 'checking' : 'anonymous',
    user: null,
    expired: false
  })
  let credential = initial
  let generation = 0
  let pending: Promise<void> | null = null

  function clear(status: Status = 'anonymous', expired = false) {
    const remembered = read(local, v3SessionKey, true)
    if (!remembered || remembered.token === credential?.token) local.removeItem(v3SessionKey)
    generation++
    pending = null
    credential = null
    state.user = null
    state.status = status
    state.expired = expired
    temporary.removeItem(v3TemporaryKey)
    temporary.removeItem(v3TabsKey)
  }

  function refresh(): Promise<void> {
    if (pending) return pending
    if (!credential) return Promise.resolve()
    if (credential.expiresAt <= Date.now()) {
      clear('anonymous', true)
      return Promise.resolve()
    }

    const current = credential
    const attempt = generation
    if (!state.user) state.status = 'checking'
    pending = Promise.resolve()
      .then(() => transport.me(current.token))
      .then((user) => {
        if (generation !== attempt) return
        if (!isRecruiter(user.role)) {
          clear('forbidden')
          return
        }
        if (state.user && state.user.id !== user.id) temporary.removeItem(v3TabsKey)
        state.user = user
        state.status = 'ready'
      })
      .catch((error: unknown) => {
        if (generation !== attempt) return
        if (error instanceof V3Error && error.status === 401) clear('anonymous', true)
        else if (error instanceof V3Error && error.status === 403) clear('forbidden')
        else {
          // Retain the mounted draft while identity cannot be revalidated.
          state.status = 'unavailable'
        }
      })
      .finally(() => {
        if (generation === attempt) pending = null
      })
    return pending
  }

  async function signIn(input: Credentials) {
    clear()
    const attempt = generation
    const result = await transport.login(input)
    if (generation !== attempt) return
    credential = { ...result, remember: input.remember }
    await refresh()
    if (state.status === 'ready' && credential?.token === result.token) {
      const storage = input.remember ? local : temporary
      storage.setItem(
        input.remember ? v3SessionKey : v3TemporaryKey,
        JSON.stringify({ token: result.token, expiresAt: result.expiresAt })
      )
    }
  }

  return {
    state,
    refresh,
    signIn,
    clear,
    token: () => credential?.token,
    version: () => generation,
    reject(token: string, status: number, version: number) {
      if (credential?.token !== token || generation !== version) return
      if (status === 401) clear('anonymous', true)
      if (status === 403) clear('forbidden')
    }
  }
}
