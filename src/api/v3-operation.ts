export function createWriteIntent<T>(key: () => string) {
  let intent: { signature: string; key: string } | null = null
  let pending = false
  let uncertain = false
  return {
    get pending() {
      return pending
    },
    get uncertain() {
      return uncertain
    },
    async execute(
      body: object,
      send: (idempotencyKey: string) => Promise<T>,
      status: (error: unknown) => number
    ) {
      if (pending) throw new Error('REQUEST_PENDING')
      const signature = JSON.stringify(body)
      if (uncertain && intent?.signature !== signature) throw new Error('RESOLVE_PREVIOUS_REQUEST')
      if (intent?.signature !== signature) intent = { signature, key: key() }
      pending = true
      try {
        const result = await send(intent.key)
        intent = null
        uncertain = false
        return result
      } catch (error) {
        const code = status(error)
        uncertain = code === 0 || code >= 500
        if (!uncertain) intent = null
        throw error
      } finally {
        pending = false
      }
    }
  }
}

export function latestRead() {
  let generation = 0
  return {
    invalidate() {
      generation++
    },
    async execute<T>(
      read: () => Promise<T>,
      accept: (result: T) => void,
      reject: (error: unknown) => void
    ) {
      const attempt = ++generation
      try {
        const result = await read()
        if (attempt === generation) accept(result)
      } catch (error) {
        if (attempt === generation) reject(error)
      }
    }
  }
}
