import express from 'express'
import { verifyV3Database } from './db/verify-v3-db.js'
import { createV3Auth } from './middleware/auth-v3.js'
import { v3ErrorHandler, v3NotFound, v3RequestContext } from './middleware/error-v3.js'

export const createV3App = ({ db, authConfig } = {}) => {
  verifyV3Database(db)
  const { router } = createV3Auth({ db, jwtSecret: authConfig?.jwtSecret })
  const app = express()
  app.disable('x-powered-by')
  app.use(v3RequestContext)
  app.use(express.json({ limit: '16kb' }))
  app.get('/api/v3/health', (_req, res) => res.json({ status: 'ok' }))
  app.use('/api/v3/auth', router)
  app.use(v3NotFound)
  app.use(v3ErrorHandler)
  return app
}
