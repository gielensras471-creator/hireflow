import { verifyV3Structure } from './v3-database-checks.js'
import { verifyPersistentV3Connection } from './persistent-v3.js'
import { isInMemoryConnection } from './database.js'

const incompatible = () => new TypeError('A prepared, isolated V3 in-memory database is required')

export const verifyV3Database = (db) => {
  if (!isInMemoryConnection(db)) {
    try {
      return verifyPersistentV3Connection(db)
    } catch {
      throw incompatible()
    }
  }
  if (!db.isOpen || db.isTransaction) throw incompatible()
  const databases = db.prepare('PRAGMA database_list').all()
  if (
    !databases.some(({ name }) => name === 'main') ||
    databases.some(({ name, file }) => !['main', 'temp'].includes(name) || file !== '') ||
    db.prepare('PRAGMA main.journal_mode').get().journal_mode !== 'memory' ||
    db.prepare('SELECT 1 FROM temp.sqlite_schema LIMIT 1').get()
  )
    throw incompatible()

  try {
    return verifyV3Structure(db)
  } catch {
    throw incompatible()
  }
}
