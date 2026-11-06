import express from 'express'
import { verifyV3Database } from './db/verify-v3-db.js'
import { createV3Auth } from './middleware/auth-v3.js'
import { createV3DecisionRoutes } from './routes/decision-v3.js'
import { createV3InterviewFeedbackRoutes } from './routes/interview-feedback-v3.js'
import { createV3RecruitingRoutes } from './routes/recruiting-v3.js'
import { v3ErrorHandler, v3NotFound, v3RequestContext } from './middleware/error-v3.js'

export const createV3App = ({ db, authConfig } = {}) => {
  verifyV3Database(db)
  const auth = createV3Auth({ db, jwtSecret: authConfig?.jwtSecret })
  const app = express()
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  app.use(v3RequestContext)
  app.use(express.json({ limit: '16kb' }))
  app.get('/api/v3/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/v3/auth', auth.router)
  app.use('/api/v3', createV3InterviewFeedbackRoutes({ db, ...auth }))
  app.use('/api/v3', createV3DecisionRoutes({ db, ...auth }))
  app.use('/api/v3', createV3RecruitingRoutes({ db, ...auth }))
  app.use(v3NotFound)
  app.use(v3ErrorHandler)
  return app
}
