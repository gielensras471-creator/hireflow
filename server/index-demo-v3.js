import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import express from 'express'
import { createV3App } from './app-v3.js'
import { createDemoDatabase } from './demo-v3.js'

const defaultStatic = fileURLToPath(new URL('../dist-demo', import.meta.url))

export function createDemoRequestGuard(now = Date.now) {
  // One shared sandbox. Bounded traffic and mutations keep public use from growing it indefinitely.
  // These process-wide limits intentionally do not trust spoofable forwarded IP headers.
  let windowStart = now(),
    reads = 0,
    logins = 0,
    writes = 0
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    res.set('Referrer-Policy', 'no-referrer')
    if (now() - windowStart >= 60000) {
      windowStart = now()
      reads = 0
      logins = 0
    }
    if (req.path.startsWith('/api/')) {
      const login = req.method === 'POST' && req.path === '/api/v3/auth/login'
      const write =
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.path.startsWith('/api/v3/auth/')
      if (++reads > 1800 || (login && ++logins > 20) || (write && ++writes > 500)) {
        if (!(write && writes > 500)) res.set('Retry-After', '60')
        return res.status(429).json({
          error: {
            code: write && writes > 500 ? 'DEMO_WRITE_LIMIT' : 'DEMO_RATE_LIMIT',
            message:
              write && writes > 500
                ? '演示写入额度已用完，请联系维护者重置演示环境。'
                : '演示访问频繁，请稍后重试。'
          }
        })
      }
    }
    next()
  }
}

export async function startDemoServer({
  password = 'a123456',
  port = 3302,
  staticDir = defaultStatic
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid demo port')
  // A dedicated artifact, never the formal frontend (which could contain the formal API URL).
  const directory = fs.realpathSync(staticDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'demo-build.json'), 'utf8'))
  if (manifest.kind !== 'hireflow-isolated-demo' || manifest.apiBase !== '/api/v3')
    throw new Error('An isolated demo build is required')
  const { db, jwtSecret } = createDemoDatabase(password)
  let server,
    closing,
    draining = false
  const app = express()
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    if (draining)
      return res
        .status(503)
        .json({ error: { code: 'SERVICE_DRAINING', message: '演示正在重置，请稍后重新登录。' } })
    next()
  })
  app.use(createDemoRequestGuard())
  app.get('/api/v3/ready', (_req, res) => res.json({ status: 'ready', environment: 'demo' }))
  const api = createV3App({ db, authConfig: { jwtSecret } })
  app.use((req, res, next) =>
    req.path === '/api' || req.path.startsWith('/api/') ? api(req, res, next) : next()
  )
  app.use(express.static(directory, { dotfiles: 'deny', index: false }))
  app.get('*', (_req, res) => res.sendFile(path.join(directory, 'index.html')))
  try {
    server = await new Promise((resolve, reject) => {
      const s = app.listen(port, '127.0.0.1', () => resolve(s))
      s.once('error', reject)
    })
    const close = () =>
      (closing ??= (async () => {
        draining = true
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            server.closeAllConnections()
            resolve()
          }, 5000)
          timer.unref()
          server.close(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        db.close()
      })())
    return { server, db, close }
  } catch (error) {
    db.close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const running = await startDemoServer({
      port: process.env.DEMO_PORT === undefined ? 3302 : Number(process.env.DEMO_PORT)
    })
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void running.close())
    console.log(
      'HireFlow isolated demo ready on loopback. Restart resets fictional data and sessions.'
    )
  } catch {
    console.error(
      'Demo startup refused. Check demo password, build and port; no formal database is used.'
    )
    process.exitCode = 1
  }
}
