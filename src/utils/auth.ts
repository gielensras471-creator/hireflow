const LOCAL_SESSION_KEY = 'hireflow_session'
const SESSION_SESSION_KEY = 'hireflow_session_temp'

export interface HireFlowSession {
  token: string
  username: string
  expiresAt: number
}

const parseSession = (raw: string | null): HireFlowSession | null => {
  if (!raw) return null

  try {
    const session = JSON.parse(raw) as HireFlowSession

    if (!session.token || !session.expiresAt || session.expiresAt <= Date.now()) {
      return null
    }

    return session
  } catch {
    return null
  }
}

export const getSession = () => {
  const temporary = parseSession(sessionStorage.getItem(SESSION_SESSION_KEY))
  if (temporary) return temporary

  const persistent = parseSession(localStorage.getItem(LOCAL_SESSION_KEY))
  if (persistent) return persistent

  clearSession()
  return null
}

export const saveSession = (session: HireFlowSession, remember: boolean) => {
  clearSession()

  const storage = remember ? localStorage : sessionStorage
  const key = remember ? LOCAL_SESSION_KEY : SESSION_SESSION_KEY
  storage.setItem(key, JSON.stringify(session))
}

export const clearSession = () => {
  localStorage.removeItem(LOCAL_SESSION_KEY)
  sessionStorage.removeItem(SESSION_SESSION_KEY)
}
