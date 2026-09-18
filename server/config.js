import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '.env') })

const defaultDatabasePath = path.resolve(__dirname, 'data', 'hireflow.db')

export const serverConfig = {
  port: Number(process.env.PORT || 3300),
  clientOrigins: String(process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || 'hireflow-dev-secret-change-before-production',
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(process.cwd(), process.env.DATABASE_PATH)
    : defaultDatabasePath
}
