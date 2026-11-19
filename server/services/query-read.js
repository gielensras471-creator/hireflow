import { CommandError } from './command-core.js'
import { requireRecruitingActor } from './recruiting-auth.js'

export const positiveId = (id) => Number.isSafeInteger(id) && id > 0

export const validateOptions = (options, keys) => {
  if (
    !options ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some((key) => !keys.includes(key))
  )
    throw new CommandError('INVALID_QUERY')
}

export const validateLimit = (limit) => {
  if (!positiveId(limit) || limit > 100) throw new CommandError('INVALID_QUERY')
}

// A deferred read transaction keeps related SELECTs on one snapshot without a write reservation.
export const createRecruitingRead = (db, resolveActor) => (context, read) => {
  if (db.isTransaction) throw new CommandError('QUERY_TRANSACTION_ACTIVE')
  db.exec('BEGIN DEFERRED')
  try {
    requireRecruitingActor(db, resolveActor, context)
    const result = read()
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}
