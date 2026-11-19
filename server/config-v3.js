import path from 'node:path'
import { parseV3Origins } from './middleware/cors-v3.js'
export function resolveV3Config(env) {
  if (env.NODE_ENV !== 'production') throw new Error('V3 production entry requires production mode')
  for (const key of ['V3_DATA_ROOT', 'V3_DATABASE_PATH'])
    if (typeof env[key] !== 'string' || !path.isAbsolute(env[key]))
      throw new Error('Explicit absolute V3 data paths required')
  if (
    typeof env.V3_JWT_SECRET !== 'string' ||
    Buffer.byteLength(env.V3_JWT_SECRET) < 32 ||
    !env.V3_JWT_SECRET.trim()
  )
    throw new Error('Explicit strong V3 signing configuration required')
  if (
    typeof env.V3_PORT !== 'string' ||
    !/^\d+$/.test(env.V3_PORT) ||
    Number(env.V3_PORT) < 1 ||
    Number(env.V3_PORT) > 65535
  )
    throw new Error('Explicit valid V3 port required')
  const shutdownMs = Number(env.V3_SHUTDOWN_MS ?? 10000)
  if (!Number.isSafeInteger(shutdownMs) || shutdownMs < 1000 || shutdownMs > 30000)
    throw new Error('Invalid shutdown budget')
  const staticDir = env.V3_STATIC_DIR
  const relativeData = staticDir ? path.relative(staticDir, env.V3_DATA_ROOT) : ''
  if (
    staticDir !== undefined &&
    (!path.isAbsolute(staticDir) ||
      (!path.isAbsolute(relativeData) &&
        relativeData !== '..' &&
        !relativeData.startsWith('..' + path.sep)))
  )
    throw new Error('Static files must not expose data directory')
  return {
    clientOrigins: parseV3Origins(env.V3_CLIENT_ORIGINS),
    root: env.V3_DATA_ROOT,
    file: env.V3_DATABASE_PATH,
    secret: env.V3_JWT_SECRET,
    port: Number(env.V3_PORT),
    host: '127.0.0.1',
    shutdownMs,
    staticDir
  }
}
