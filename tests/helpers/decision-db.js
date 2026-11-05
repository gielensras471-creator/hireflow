import { fixture } from './v3-db.js'
import { createFeedbackService } from '../../server/services/feedback-service.js'
import { createAdvancementService } from '../../server/services/advancement-service.js'
export const decisionFixture = (t) => {
  const f = fixture(t)
  f.db.exec("UPDATE users SET role='招聘管理员' WHERE id=1")
  const candidateId = f.candidate(),
    context = {},
    sessions = new WeakMap([[context, 1]]),
    resolveActor = (c) => sessions.get(c)
  const feedback = createFeedbackService({ db: f.db, resolveActor }),
    advancement = createAdvancementService({ db: f.db, resolveActor })
  let key = 0
  const version = () =>
    f.db.prepare('SELECT version FROM candidates WHERE id=?').get(candidateId).version
  const request = (command, payload, extra = {}) => ({
    command,
    payload,
    aggregateId: candidateId,
    expectedVersion: version(),
    idempotencyKey: 'decision-' + ++key,
    ...extra
  })
  return {
    ...f,
    candidateId,
    context,
    sessions,
    resolveActor,
    feedback,
    advancement,
    version,
    request,
    submit: (interviewId, extra = {}, options = {}) =>
      feedback.execute(
        context,
        request(
          'feedback.submit',
          {
            interview_id: interviewId,
            reviewer_name: 'Professional reviewer',
            recommendation: 'recommend',
            reason: 'Evidence',
            ...extra
          },
          options
        )
      ),
    advance: (payload = {}, options = {}) =>
      advancement.execute(context, request('application.advance', payload, options))
  }
}
export const decisionCounts = (db) =>
  ['feedback', 'business_events', 'command_receipts', 'advancement_missing_feedback'].map(
    (t) => db.prepare('SELECT COUNT(*) n FROM ' + t).get().n
  )
