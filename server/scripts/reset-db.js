import fs from 'node:fs'
import { loadServerConfig } from '../config.js'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const resetDatabase = ({ databasePath: dbPath }) => {
  for (const suffix of ['', '-shm', '-wal']) {
    const target = `${dbPath}${suffix}`
    if (fs.existsSync(target)) fs.rmSync(target, { force: true })
  }

  console.log(`Database removed: ${dbPath}`)
  console.log('Run "pnpm api" to create and seed a fresh database.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  resetDatabase(loadServerConfig())
}
