import fs from 'node:fs'
import { serverConfig } from '../config.js'

const dbPath = serverConfig.databasePath

for (const suffix of ['', '-shm', '-wal']) {
  const target = `${dbPath}${suffix}`
  if (fs.existsSync(target)) fs.rmSync(target, { force: true })
}

console.log(`Database removed: ${dbPath}`)
console.log('Run "pnpm api" to create and seed a fresh database.')
