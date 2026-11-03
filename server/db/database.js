import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const openDatabase = (databasePath) => {
  if (
    typeof databasePath !== 'string' ||
    !databasePath ||
    (databasePath !== ':memory:' && !path.isAbsolute(databasePath))
  ) {
    throw new TypeError('An explicit absolute database path or :memory: is required')
  }
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    db.transaction =
      (callback) =>
      (...args) => {
        db.exec('BEGIN')
        try {
          const result = callback(...args)
          if (result && typeof result.then === 'function')
            throw new TypeError('SQLite transactions must be synchronous')
          db.exec('COMMIT')
          return result
        } catch (error) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* Preserve the original error. */
          }
          throw error
        }
      }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
