import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'

const stages = ['screening', 'first_interview', 'second_interview', 'offer']
const activeOfferStatuses = ['preparing', 'sent', 'accepted']
const closureOutcomes = ['company_rejected', 'candidate_withdrew']
const offerActions = {
  'offer.send': { from: 'preparing', to: 'sent', eventType: 'offer_sent' },
  'offer.accept': { from: 'sent', to: 'accepted', eventType: 'offer_accepted' },
  'offer.decline': {
    from: 'sent',
    to: 'declined',
    outcome: 'offer_declined',
    eventType: 'offer_declined'
  },
  'offer.confirmHire': { from: 'accepted', outcome: 'hired', eventType: 'candidate_hired' }
}
const defaultHireReason = 'HR 确认录用'

const fail = (code) => {
  throw new CommandError(code)
}
const activeBlock = (candidate) => {
  if (candidate.application_status === 'closed') return 'APPLICATION_CLOSED'
  if (
    candidate.application_status !== 'active' ||
    !stages.includes(candidate.stage) ||
    candidate.outcome !== null ||
    candidate.closed_at !== null ||
    candidate.closed_reason !== null
  )
    return 'INVALID_APPLICATION_STATE'
  const validOfferStatus =
    candidate.stage === 'offer'
      ? activeOfferStatuses.includes(candidate.offer_status)
      : candidate.offer_status === null
  return validOfferStatus ? null : 'INVALID_APPLICATION_STATE'
}
const offerBlock = (candidate, action) => {
  const blocked = activeBlock(candidate)
  if (blocked) return blocked
  if (candidate.stage !== 'offer') return 'INVALID_OFFER_STAGE'
  return candidate.offer_status === action.from ? null : 'INVALID_OFFER_STATUS'
}
const validatePayload = (payload, keys) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).some((key) => !keys.includes(key))
  )
    fail('INVALID_FIELDS')
}
const requireReason = (reason) => {
  if (typeof reason !== 'string' || !reason.trim()) fail('CLOSURE_REASON_REQUIRED')
  return reason
}
const closedFields = (outcome, reason, now) => ({
  application_status: 'closed',
  outcome,
  closed_reason: reason,
  closed_at: now
})
const describe = (before, after, reasonSource) => ({
  reason: after.closed_reason,
  context: {
    stage: before.stage,
    previousOfferStatus: before.offer_status,
    offerStatus: after.offer_status,
    outcome: after.outcome,
    ...(reasonSource ? { reasonSource } : {})
  }
})

export const createOfferService = ({ db, resolveActor }) => {
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  const read = (context, id) => {
    requireRecruitingActor(db, resolveActor, context)
    if (!Number.isSafeInteger(id) || id < 1) fail('INVALID_ID')
    const row = db
      .prepare(
        `
      SELECT id,stage,application_status,offer_status,outcome,closed_reason,closed_at,version
      FROM candidates WHERE id=?
    `
      )
      .get(id)
    if (!row) fail('AGGREGATE_NOT_FOUND')
    return { ...row }
  }
  // One live appointment blocks closure regardless of its stage scope or scheduled time.
  const pendingInterview = (id) =>
    db
      .prepare(
        `
    SELECT id,stage_scope,scheduled_at FROM interviews
    WHERE candidate_id=? AND status='scheduled' LIMIT 1
  `
      )
      .get(id)
  const requireNoAppointment = (id) => {
    if (pendingInterview(id)) fail('SCHEDULED_INTERVIEW_PENDING')
  }

  for (const [name, action] of Object.entries(offerActions)) {
    core.register(name, {
      aggregate: 'candidate',
      eventType: action.eventType,
      change: (before, payload = {}, _actor, now) => {
        const blocked = offerBlock(before, action)
        if (blocked) fail(blocked)
        validatePayload(payload, action.outcome ? ['reason'] : [])
        if (!action.outcome) return { offer_status: action.to }
        requireNoAppointment(before.id)
        const reason =
          action.outcome === 'hired' && !Object.hasOwn(payload, 'reason')
            ? defaultHireReason
            : requireReason(payload.reason)
        return {
          ...closedFields(action.outcome, reason, now),
          ...(action.to ? { offer_status: action.to } : {})
        }
      },
      describe: (before, after, payload = {}) => {
        const metadata = describe(before, after)
        if (action.outcome) {
          metadata.context.reasonSource = Object.hasOwn(payload, 'reason')
            ? 'hr_input'
            : 'system_default'
        }
        return metadata
      }
    })
  }
  core.register('application.close', {
    aggregate: 'candidate',
    eventType: 'application_closed',
    change: (before, payload, _actor, now) => {
      const blocked = activeBlock(before)
      if (blocked) fail(blocked)
      validatePayload(payload, ['outcome', 'reason'])
      if (!closureOutcomes.includes(payload.outcome)) fail('INVALID_CLOSURE_OUTCOME')
      const reason = requireReason(payload.reason)
      requireNoAppointment(before.id)
      return closedFields(payload.outcome, reason, now)
    },
    describe: (before, after) => describe(before, after, 'hr_input')
  })

  return Object.freeze({
    execute: core.execute,
    offerDetail: read,
    offerPreflight: (context, id) => {
      const candidate = read(context, id)
      const pending = pendingInterview(id)
      const actions = Object.fromEntries(
        Object.entries(offerActions).map(([name, action]) => {
          const blockedReason =
            offerBlock(candidate, action) ??
            (action.outcome && pending ? 'SCHEDULED_INTERVIEW_PENDING' : null)
          return [name, { allowed: blockedReason === null, blockedReason }]
        })
      )
      return { candidate, actions, pendingInterviews: pending ? [{ ...pending }] : [] }
    },
    closurePreflight: (context, id) => {
      const candidate = read(context, id)
      const pending = pendingInterview(id)
      const blockedReason =
        activeBlock(candidate) ?? (pending ? 'SCHEDULED_INTERVIEW_PENDING' : null)
      return {
        candidate,
        allowed: blockedReason === null,
        blockedReason,
        pendingInterviews: pending ? [{ ...pending }] : [],
        allowedOutcomes: [...closureOutcomes]
      }
    },
    history: (context, id) => {
      read(context, id)
      return db
        .prepare(
          `
        SELECT id,command_id,event_type,actor_user_id,actor_name_snapshot,occurred_at,reason,
          aggregate_version,old_values_json,new_values_json,context_json
        FROM business_events WHERE candidate_id=?
          AND event_type IN ('offer_sent','offer_accepted','offer_declined','candidate_hired','application_closed')
        ORDER BY aggregate_version
      `
        )
        .all(id)
        .map(({ old_values_json, new_values_json, context_json, ...event }) => ({
          ...event,
          before: JSON.parse(old_values_json),
          after: JSON.parse(new_values_json),
          context: JSON.parse(context_json)
        }))
    }
  })
}
