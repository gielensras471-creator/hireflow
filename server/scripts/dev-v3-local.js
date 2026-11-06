import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { createServer } from 'vite'
import { createV3App } from '../app-v3.js'
import { openDatabase } from '../db/database.js'
import { createV3Schema } from '../db/schema-v3.js'

const host = '127.0.0.1'
const username = 'local-hr'

export async function startV3Local({ port = 5174 } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('V3 local development is disabled in production')
  }

  const password = randomBytes(18).toString('base64url')
  const db = openDatabase(':memory:')
  let api
  let vite
  let closing

  function close() {
    closing ??= (async () => {
      try {
        await vite?.close()
      } finally {
        if (api?.listening) await new Promise((resolve) => api.close(resolve))
        db.close()
      }
    })()
    return closing
  }

  try {
    createV3Schema(db)
    db.prepare(
      'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
    ).run(username, bcrypt.hashSync(password, 10), '本地演示 HR', 'hr', '', '', '')

    const app = createV3App({ db, authConfig: { jwtSecret: randomBytes(48).toString('hex') } })
    api = await new Promise((resolve, reject) => {
      const server = app.listen(0, host, () => resolve(server))
      server.once('error', reject)
    })
    vite = await createServer({
      mode: 'v3-local',
      server: {
        host,
        port,
        strictPort: true,
        proxy: {
          '^/api/v3(?:/|$)': {
            target: 'http://' + host + ':' + api.address().port,
            changeOrigin: true
          }
        }
      }
    })
    if (port === 0) {
      await new Promise((resolve, reject) => {
        vite.httpServer.once('error', reject)
        vite.httpServer.listen(0, host, resolve)
      })
    } else {
      await vite.listen()
    }
    return {
      url: 'http://' + host + ':' + vite.httpServer.address().port,
      username,
      password,
      close
    }
  } catch (error) {
    await close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--local')
    throw new Error('Use pnpm dev:v3 to start V3 local development')
  const { url, username, password, close } = await startV3Local()
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close())
  console.log('V3 local UI: ' + url)
  if (process.stdout.isTTY) console.log('Temporary login: ' + username + ' / ' + password)
}
