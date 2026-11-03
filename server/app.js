import express from 'express'
import cors from 'cors'
import { createRequireAuth } from './middleware/auth.js'
import { createTokenService } from './utils/jwt.js'
import { errorHandler, notFound } from './middleware/error.js'
import { createAuthRoutes } from './routes/auth.js'
import { createCandidateRoutes } from './routes/candidates.js'
import { createInterviewRoutes } from './routes/interviews.js'
import { createPositionRoutes } from './routes/positions.js'
import { createProfileRoutes } from './routes/profile.js'

export const createApp = ({ db, config }) => {
  if (!db || !config) throw new TypeError('An explicit database and config are required')
  const { signAccessToken, verifyAccessToken } = createTokenService(config.jwtSecret)
  const requireAuth = createRequireAuth(verifyAccessToken)
  const app = express()
  const configuredOrigins = config.clientOrigins
  const isProduction = config.isProduction

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

  app.use('/api/auth', createAuthRoutes({ db, requireAuth, signAccessToken }))
  app.use('/api', requireAuth)
  app.use('/api/profile', createProfileRoutes({ db }))
  app.use('/api/positions', createPositionRoutes({ db }))
  app.use('/api/candidates', createCandidateRoutes({ db }))
  app.use('/api/interviews', createInterviewRoutes({ db }))

  app.use(notFound)
  app.use(errorHandler)

  return app
}
