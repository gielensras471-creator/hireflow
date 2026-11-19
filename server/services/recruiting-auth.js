import { CommandError } from './command-core.js'

const roles = new Set(['招聘管理员', 'hr', 'admin'])
export const authorizeRecruiting = (user) => roles.has(user.role)
// resolveActor is a trusted, synchronous server authentication adapter, never request-body lookup.
export const requireRecruitingActor = (db, resolveActor, context) => {
  if (typeof resolveActor !== 'function' || resolveActor.constructor.name === 'AsyncFunction')
    throw new CommandError('INVALID_ACTOR')
  const id = resolveActor(context)
  if (id && typeof id.then === 'function') {
    Promise.resolve(id).catch(() => {})
    throw new CommandError('INVALID_ACTOR')
  }
  if (!Number.isSafeInteger(id) || id < 1) throw new CommandError('INVALID_ACTOR')
  const user = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(id)
  if (!user || !user.name?.trim()) throw new CommandError('INVALID_ACTOR')
  if (!authorizeRecruiting(user)) throw new CommandError('FORBIDDEN')
  return user
}
