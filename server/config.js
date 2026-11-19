import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const defaultDatabasePath = path.resolve(__dirname, 'data', 'hireflow.db')

export const resolveServerConfig = (env) => ({
  port: Number(env.PORT || 3300),
  clientOrigins: String(env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  jwtSecret: env.JWT_SECRET || 'hireflow-dev-secret-change-before-production',
  databasePath: env.DATABASE_PATH
    ? path.resolve(process.cwd(), env.DATABASE_PATH)
    : defaultDatabasePath,
  isProduction: env.NODE_ENV === 'production'
})

export const loadServerConfig = () => {
  dotenv.config({ path: path.resolve(__dirname, '.env') })
  return resolveServerConfig(process.env)
}
