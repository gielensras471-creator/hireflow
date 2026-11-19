import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from '../../server/db/database.js'
import { createSchema } from '../../server/db/schema.js'

const ownedRoots = new Set()

export const createTestWorkspace = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hireflow-test-')))
  ownedRoots.add(root)
  return root
}

export const openTestDatabase = ({ root, databasePath } = {}) => {
  if (databasePath === undefined || databasePath === ':memory:') return openDatabase(':memory:')
  if (!root || !ownedRoots.has(root) || !path.isAbsolute(databasePath)) {
    throw new Error('File tests require an owned temporary workspace and explicit absolute path')
  }
  const target = path.resolve(databasePath)
  if (
    path.dirname(target) !== root ||
    fs.realpathSync(path.dirname(target)) !== root ||
    path.extname(target) !== '.db' ||
    (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
  ) {
    throw new Error('Test database must be a direct .db file inside its owned workspace')
  }
  return openDatabase(target)
}

export const createTestDatabase = (options) => {
  const db = openTestDatabase(options)
  try {
    createSchema(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export const removeTestWorkspace = (root) => {
  if (!ownedRoots.has(root) || fs.realpathSync(root) !== root)
    throw new Error('Not an owned test workspace')
  fs.rmSync(root, { recursive: true })
  ownedRoots.delete(root)
}
