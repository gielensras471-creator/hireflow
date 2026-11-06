import { createCommandCore, CommandError } from './command-core.js'
import { authorizeRecruiting, requireRecruitingActor } from './recruiting-auth.js'
import { createRecruitingRead, validateLimit } from './query-read.js'
const reject = (code) => {
  throw new CommandError(code)
}
const id = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) reject('INVALID_ID')
  return value
}
const date = (value) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    reject('INVALID_DATE')
  return value
}
const fields = (p, allowed, required = []) => {
  if (
    !p ||
    typeof p !== 'object' ||
    Array.isArray(p) ||
    Object.keys(p).some((k) => !allowed.includes(k))
  )
    reject('INVALID_FIELDS')
  for (const k of required) if (!Object.hasOwn(p, k)) reject('MISSING_FIELD')
  for (const [k, v] of Object.entries(p))
    if (k !== 'position_id' && typeof v !== 'string') reject('INVALID_FIELD_TYPE')
  for (const k of ['title', 'name', 'owner'])
    if (Object.hasOwn(p, k) && !p[k].trim()) reject('EMPTY_FIELD')
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) reject('INVALID_EMAIL')
  for (const k of ['publish_date', 'applied_date']) if (Object.hasOwn(p, k)) date(p[k])
  return { ...p }
}
const changedFields = (before, patch) => {
  if (Object.entries(patch).every(([key, value]) => before[key] === value)) reject('NO_CHANGE')
  return patch
}
const positionFields = ['title', 'department', 'location', 'publish_date', 'description']
const applicantFields = [
  'name',
  'education',
  'school',
  'phone',
  'email',
  'owner',
  'skills',
  'experience',
  'note',
  'applied_date'
]
export const createRecruitingService = ({ db, resolveActor }) => {
  const core = createCommandCore({ db, resolveActor, authorize: authorizeRecruiting })
  const assertLive = (position) => {
    if (position.deleted_at !== null) reject('POSITION_DELETED')
  }
  const counts = (positionId) =>
    db
      .prepare(
        "SELECT COUNT(*) total,COALESCE(SUM(application_status='active'),0) active FROM candidates WHERE position_id=?"
      )
      .get(positionId)
  const risk = (positionId) => {
    const n = counts(positionId),
      legacy = db
        .prepare('SELECT COUNT(*) n FROM legacy_records WHERE mapped_position_id=?')
        .get(positionId).n
    return {
      applicationRecords: n.total,
      activeApplications: n.active,
      legacyReferences: legacy,
      warning: n.active > 0 ? 'POSITION_HAS_ACTIVE_APPLICATIONS' : null
    }
  }
  core.register('position.create', {
    aggregate: 'position',
    mode: 'create',
    eventType: 'position_created',
    change: (_b, p) => ({
      ...fields(p, positionFields, positionFields),
      status: 'open',
      deleted_at: null
    })
  })
  core.register('position.update', {
    aggregate: 'position',
    eventType: 'position_updated',
    change: (b, p) => {
      assertLive(b)
      return changedFields(b, fields(p, positionFields))
    }
  })
  core.register('position.status', {
    aggregate: 'position',
    eventType: 'position_status_changed',
    change: (b, p) => {
      assertLive(b)
      fields(p, ['status'], ['status'])
      if (!['open', 'closed'].includes(p.status)) reject('INVALID_STATUS')
      return changedFields(b, { status: p.status })
    },
    describe: (_b, a) => ({ context: risk(a.id) })
  })
  core.register('position.delete', {
    aggregate: 'position',
    eventType: 'position_deleted',
    change: (b, p, _u, now) => {
      assertLive(b)
      fields(p, [])
      return { deleted_at: now }
    },
    describe: (_b, a) => ({ context: { ...risk(a.id), deletion: 'soft' } })
  })
  core.register('application.create', {
    aggregate: 'candidate',
    mode: 'create',
    eventType: 'candidate_created',
    change: (_b, p, _u, now) => {
      const values = fields(
        p,
        ['position_id', ...applicantFields],
        ['position_id', 'name', 'owner', 'applied_date']
      )
      const position = db.prepare('SELECT * FROM positions WHERE id=?').get(id(values.position_id))
      if (!position || position.status !== 'open' || position.deleted_at !== null)
        reject('POSITION_NOT_OPEN')
      return {
        education: '',
        school: '',
        phone: '',
        email: '',
        skills: '',
        experience: '',
        note: '',
        ...values,
        created_at: now,
        stage: 'screening',
        application_status: 'active',
        outcome: null,
        offer_status: null,
        closed_reason: null,
        closed_at: null
      }
    }
  })
  core.register('application.update', {
    aggregate: 'candidate',
    eventType: 'candidate_updated',
    change: (b, p) => {
      if (b.application_status !== 'active') reject('APPLICATION_CLOSED')
      return changedFields(b, fields(p, applicantFields))
    }
  })
  const auth = (context) => requireRecruitingActor(db, resolveActor, context)
  const read = createRecruitingRead(db, resolveActor)
  const applicationJoin = 'FROM candidates c JOIN positions p ON p.id=c.position_id'
  const positionRelation =
    'p.title AS position_title,p.status AS position_status,p.deleted_at AS position_deleted_at'
  const page = (projection, from, predicates, params, sort, limit, offset) => {
    validateLimit(limit)
    if (!Number.isSafeInteger(offset) || offset < 0) reject('INVALID_QUERY')
    const scope = from + ' WHERE ' + predicates
    const total = db.prepare('SELECT COUNT(*) AS n ' + scope).get(...params).n
    const items = db
      .prepare('SELECT ' + projection + ' ' + scope + ' ORDER BY ' + sort + ' LIMIT ? OFFSET ?')
      .all(...params, limit, offset)
    return { items, total, limit, offset }
  }
  const positionDetail = (context, positionId) => {
    auth(context)
    const p = db.prepare('SELECT * FROM positions WHERE id=?').get(id(positionId))
    if (!p) reject('AGGREGATE_NOT_FOUND')
    return { ...p, ...risk(p.id) }
  }
  return Object.freeze({
    execute: (context, request) => {
      const response = core.execute(context, request)
      if (['position.status', 'position.delete'].includes(request.command)) {
        const event = db
          .prepare('SELECT context_json FROM business_events WHERE command_id=?')
          .get(response.result.commandId)
        return { ...response, risk: JSON.parse(event.context_json) }
      }
      return response
    },
    positionDetail,
    positionsPage: (context, { status, q, limit = 50, offset = 0 } = {}) =>
      read(context, () => {
        const keyword = q ?? null
        const result = page(
          'p.*',
          'FROM positions p',
          '(? IS NULL OR p.status=?) AND (? IS NULL OR instr(lower(p.title),lower(?))>0 OR instr(lower(p.department),lower(?))>0 OR instr(lower(p.location),lower(?))>0)',
          [status ?? null, status ?? null, keyword, keyword, keyword, keyword],
          'p.id',
          limit,
          offset
        )
        return { ...result, items: result.items.map((p) => ({ ...p, ...risk(p.id) })) }
      }),
    applicationsPage: (
      context,
      { positionId, stage, applicationStatus, q, limit = 50, offset = 0 } = {}
    ) =>
      read(context, () => {
        const keyword = q ?? null
        return page(
          'c.id,c.name,c.owner,c.applied_date,c.created_at,c.position_id,c.stage,c.application_status,c.outcome,c.offer_status,c.closed_at,c.version,' +
            positionRelation,
          applicationJoin,
          '(? IS NULL OR c.position_id=?) AND (? IS NULL OR c.stage=?) AND (? IS NULL OR c.application_status=?) AND (? IS NULL OR instr(lower(c.name),lower(?))>0 OR instr(lower(c.owner),lower(?))>0 OR instr(lower(p.title),lower(?))>0)',
          [
            positionId ?? null,
            positionId ?? null,
            stage ?? null,
            stage ?? null,
            applicationStatus ?? null,
            applicationStatus ?? null,
            keyword,
            keyword,
            keyword,
            keyword
          ],
          'c.id',
          limit,
          offset
        )
      }),
    applicationDetail: (context, applicationId) =>
      read(context, () => {
        const row = db
          .prepare('SELECT c.*,' + positionRelation + ' ' + applicationJoin + ' WHERE c.id=?')
          .get(id(applicationId))
        if (!row) reject('AGGREGATE_NOT_FOUND')
        return row
      }),
    positions: (context) => {
      auth(context)
      return db
        .prepare('SELECT * FROM positions ORDER BY id')
        .all()
        .map((p) => ({ ...p, ...risk(p.id) }))
    },
    positionOptions: (context) => {
      auth(context)
      return db
        .prepare(
          "SELECT id,title FROM positions WHERE status='open' AND deleted_at IS NULL ORDER BY id"
        )
        .all()
    },
    applications: (context) => {
      auth(context)
      return db
        .prepare('SELECT c.*,' + positionRelation + ' ' + applicationJoin + ' ORDER BY c.id')
        .all()
    }
  })
}
