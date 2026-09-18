import express from 'express'
import cors from 'cors'
import { serverConfig } from './config.js'
import { databasePath } from './db/database.js'
import { requireAuth } from './middleware/auth.js'
import { errorHandler, notFound } from './middleware/error.js'
import authRoutes from './routes/auth.js'
import candidateRoutes from './routes/candidates.js'
import interviewRoutes from './routes/interviews.js'
import positionRoutes from './routes/positions.js'
import profileRoutes from './routes/profile.js'

const app = express()
const port = serverConfig.port
const configuredOrigins = serverConfig.clientOrigins
const isProduction = process.env.NODE_ENV === 'production'

const isLocalDevelopmentOrigin = (origin) => {
  if (isProduction || !origin) return false

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  } catch {
    return false
  }
}

app.disable('x-powered-by')

app.use(
  cors({
    origin(origin, callback) {
      const allowed =
        !origin ||
        configuredOrigins.includes('*') ||
        configuredOrigins.includes(origin) ||
        isLocalDevelopmentOrigin(origin)

      if (allowed) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS blocked origin: ${origin}`))
    },
    credentials: true
  })
)

app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'HireFlow API',
    database: 'sqlite'
  })
})

app.use('/api/auth', authRoutes)
app.use('/api', requireAuth)
app.use('/api/profile', profileRoutes)
app.use('/api/positions', positionRoutes)
app.use('/api/candidates', candidateRoutes)
app.use('/api/interviews', interviewRoutes)

app.use(notFound)
app.use(errorHandler)

app.listen(port, () => {
  console.log(`HireFlow API running at http://localhost:${port}`)
  console.log(`SQLite database: ${databasePath}`)
  console.log(
    `Allowed client origins: ${
      isProduction ? configuredOrigins.join(', ') : 'localhost / 127.0.0.1 (development)'
    }`
  )
})
