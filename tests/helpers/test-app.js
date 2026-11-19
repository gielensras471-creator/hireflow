import { createApp } from '../../server/app.js'
import { createTestDatabase } from './test-db.js'

export const testConfig = Object.freeze({
  jwtSecret: 'isolated-test-secret-only',
  clientOrigins: ['http://localhost:5173'],
  isProduction: false
})

export const createTestApp = () => {
  const db = createTestDatabase()
  try {
    return { db, app: createApp({ db, config: testConfig }) }
  } catch (error) {
    db.close()
    throw error
  }
}
