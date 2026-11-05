import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'
const fail = (code) => {
  throw new CommandError(code)
}
export const createFeedbackService = ({ db, resolveActor }) => {
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  core.register('feedback.submit', {
    aggregate: 'candidate',
    mode: 'feedback',
    eventType: 'feedback_submitted',
    change: (b, p, user, now) => {
      if (b.application_status !== 'active') fail('APPLICATION_CLOSED')
      if (
        !p ||
        Array.isArray(p) ||
        Object.keys(p).some(
          (k) => !['interview_id', 'reviewer_name', 'recommendation', 'reason'].includes(k)
        )
      )
        fail('INVALID_FIELDS')
      if (!Number.isSafeInteger(p.interview_id) || p.interview_id < 1) fail('INVALID_INTERVIEW')
      for (const key of ['reviewer_name', 'reason'])
        if (typeof p[key] !== 'string' || !p[key].trim()) fail('INVALID_FEEDBACK')
      if (!['recommend', 'not_recommend', 'undecided'].includes(p.recommendation))
        fail('INVALID_RECOMMENDATION')
      const i = db
        .prepare('SELECT * FROM interviews WHERE id=? AND candidate_id=?')
        .get(p.interview_id, b.id)
      if (!i) fail('INTERVIEW_ASSOCIATION_CONFLICT')
      if (i.status !== 'completed') fail('INTERVIEW_NOT_COMPLETED')
      if (i.stage_scope !== b.stage) fail('HISTORICAL_FEEDBACK_NOT_ALLOWED')
      if (db.prepare('SELECT 1 FROM feedback WHERE interview_id=?').get(i.id))
        fail('FEEDBACK_ALREADY_EXISTS')
      const result = db
        .prepare(
          'INSERT INTO feedback(interview_id,reviewer_name,recorded_by_user_id,recommendation,reason,submitted_at,revision) VALUES (?,?,?,?,?,?,1)'
        )
        .run(i.id, p.reviewer_name, user.id, p.recommendation, p.reason, now)
      return { feedbackId: Number(result.lastInsertRowid) }
    }
  })
  return Object.freeze({
    execute: core.execute,
    byApplication: (context, id) => {
      requireRecruitingActor(db, resolveActor, context)
      if (!Number.isSafeInteger(id) || id < 1) fail('INVALID_ID')
      if (!db.prepare('SELECT 1 FROM candidates WHERE id=?').get(id)) fail('AGGREGATE_NOT_FOUND')
      return db
        .prepare(
          'SELECT f.*,i.stage_scope FROM feedback f JOIN interviews i ON i.id=f.interview_id WHERE i.candidate_id=? ORDER BY f.id'
        )
        .all(id)
    }
  })
}
