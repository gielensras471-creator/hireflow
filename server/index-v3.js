import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import express from 'express'
import { createV3App } from './app-v3.js'
import { resolveV3Config } from './config-v3.js'
import { openPersistentV3 } from './db/persistent-v3.js'
export async function startV3Server(env = process.env) {
  const config = resolveV3Config(env),
    db = openPersistentV3(config.root, config.file)
  let server,
    draining = false,
    closing
  try {
    if (!db.prepare("SELECT 1 FROM users WHERE role IN ('hr','招聘管理员') LIMIT 1").get())
      throw new Error('Offline HR provisioning required')
    const api = createV3App({
        db,
        accountWrites: true,
        clientOrigins: config.clientOrigins,
        authConfig: { jwtSecret: config.secret }
      }),
      app = express()
    app.disable('x-powered-by')
    app.use((req, res, next) => {
      if (draining)
        return res
          .status(503)
          .json({ error: { code: 'SERVICE_DRAINING', message: 'Service stopping' } })
      next()
    })
    app.get('/api/v3/ready', (_req, res) =>
      res
        .status(db.isOpen && !db.isTransaction ? 200 : 503)
        .json({ status: db.isOpen && !db.isTransaction ? 'ready' : 'unavailable' })
    )
    app.use((req, res, next) =>
      req.path === '/api' || req.path.startsWith('/api/') ? api(req, res, next) : next()
    )
    if (config.staticDir) {
      const directory = fs.realpathSync(config.staticDir)
      if (!fs.statSync(path.join(directory, 'index.html')).isFile())
        throw new Error('V3 static build missing')
      const relativeData = path.relative(directory, fs.realpathSync(config.root))
      if (
        !path.isAbsolute(relativeData) &&
        relativeData !== '..' &&
        !relativeData.startsWith('..' + path.sep)
      )
        throw new Error('Static directory exposes V3 data')
      app.use(express.static(directory))
      app.get('*', (_req, res) => res.sendFile(path.join(directory, 'index.html')))
    }
    server = await new Promise((resolve, reject) => {
      const s = app.listen(config.port, config.host, () => resolve(s))
      s.once('error', reject)
    })
    const close = () =>
      (closing ??= (async () => {
        draining = true
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            server.closeAllConnections()
            resolve()
          }, config.shutdownMs)
          timer.unref()
          server.close(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        db.close()
      })())
    return { app, server, db, close }
  } catch (e) {
    if (server?.listening) await new Promise((r) => server.close(r))
    if (db.isOpen) db.close()
    throw e
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const running = await startV3Server()
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, () => {
        void running.close().catch(() => {
          process.exitCode = 1
        })
      })
    console.log('V3 service ready')
  } catch {
    console.error('V3 startup refused; check approved configuration and database')
    process.exitCode = 1
  }
}
