import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadServerConfig } from './config.js'
import { openDatabase } from './db/database.js'
import { createSchema } from './db/schema.js'
import { seedDatabase, loadSeedData } from './db/seed.js'
import { createApp } from './app.js'

export const startServer = (config = loadServerConfig()) => {
  const db = openDatabase(config.databasePath)
  try {
    createSchema(db)
    seedDatabase(db, loadSeedData())
    const app = createApp({ db, config })
    const server = app.listen(config.port, () => {
      console.log('HireFlow API running on port ' + config.port)
      console.log('SQLite database: ' + config.databasePath)
    })
    server.once('close', () => {
      if (db.isOpen) db.close()
    })
    server.once('error', (error) => {
      if (db.isOpen) db.close()
      console.error('HireFlow API failed to listen:', error)
      process.exitCode = 1
    })
    return { app, server, db }
  } catch (error) {
    db.close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer()
}
