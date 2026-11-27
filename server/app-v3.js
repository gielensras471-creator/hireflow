import express from 'express'
import { v3Cors } from './middleware/cors-v3.js'
import { verifyV3Database } from './db/verify-v3-db.js'
import { isInMemoryConnection } from './db/database.js'
import { addV3AuthVersion, authSchemaFingerprint } from './db/v3-auth-migration.js'
import { createV3Auth } from './middleware/auth-v3.js'
import { createV3DashboardHistoryRoutes } from './routes/dashboard-history-v3.js'
import { createV3DecisionRoutes } from './routes/decision-v3.js'
import { createV3InterviewFeedbackRoutes } from './routes/interview-feedback-v3.js'
import { createV3RecruitingRoutes } from './routes/recruiting-v3.js'
import { v3ErrorHandler, v3NotFound, v3RequestContext } from './middleware/error-v3.js'

export const createV3App = ({ db, authConfig, clientOrigins = [], accountWrites = false } = {}) => {
  if (verifyV3Database(db) !== authSchemaFingerprint) {
    if (!isInMemoryConnection(db)) throw new Error('Offline V3 auth migration required')
    addV3AuthVersion(db)
  }
  const auth = createV3Auth({ db, jwtSecret: authConfig?.jwtSecret, accountWrites })
  const app = express()
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use(v3RequestContext)
  app.use(v3Cors(clientOrigins))
  app.use(express.json({ limit: '16kb' }))
  app.get('/api/v3/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/v3/auth', auth.router)
  app.use('/api/v3', createV3InterviewFeedbackRoutes({ db, ...auth }))
  app.use('/api/v3', createV3DecisionRoutes({ db, ...auth }))
  app.use('/api/v3', createV3DashboardHistoryRoutes({ db, ...auth }))
  app.use('/api/v3', createV3RecruitingRoutes({ db, ...auth }))
  app.use(v3NotFound)
  app.use(v3ErrorHandler)
  return app
}
