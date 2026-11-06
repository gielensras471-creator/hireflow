import { Router } from 'express'
import { V3HttpError } from '../middleware/error-v3.js'
import { createRecruitingService } from '../services/recruiting-service.js'

const positionFields = {
  title: 'title',
  department: 'department',
  location: 'location',
  publishDate: 'publish_date',
  description: 'description'
}
const applicationFields = {
  name: 'name',
  education: 'education',
  school: 'school',
  phone: 'phone',
  email: 'email',
  owner: 'owner',
  skills: 'skills',
  experience: 'experience',
  note: 'note',
  appliedDate: 'applied_date'
}
const applicationSummaryFields = {
  id: 'id',
  name: 'name',
  owner: 'owner',
  appliedDate: 'applied_date',
  createdAt: 'created_at',
  positionId: 'position_id',
  positionTitle: 'position_title',
  positionStatus: 'position_status',
  positionDeletedAt: 'position_deleted_at',
  stage: 'stage',
  applicationStatus: 'application_status',
  outcome: 'outcome',
  offerStatus: 'offer_status',
  closedAt: 'closed_at',
  version: 'version'
}

const project = (row, fields) =>
  Object.fromEntries(Object.entries(fields).map(([output, input]) => [output, row[input]]))
const positionDto = (row) =>
  project(row, {
    ...positionFields,
    id: 'id',
    status: 'status',
    deletedAt: 'deleted_at',
    version: 'version',
    applicationRecords: 'applicationRecords',
    activeApplications: 'activeApplications',
    legacyReferences: 'legacyReferences',
    warning: 'warning'
  })
const applicationDto = (row) => project(row, applicationSummaryFields)
const applicationDetailDto = (row) =>
  project(row, {
    ...applicationSummaryFields,
    ...applicationFields,
    closedReason: 'closed_reason'
  })

const fail = (code) => {
  throw new V3HttpError(code)
}
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail('INVALID_REQUEST')
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) fail('INVALID_REQUEST')
  return number
}

const options = (query, resource) => {
  const allowed =
    resource === 'positions'
      ? ['q', 'limit', 'offset', 'status']
      : ['q', 'limit', 'offset', 'positionId', 'stage', 'applicationStatus']
  if (
    Object.entries(query).some(
      ([key, value]) => !allowed.includes(key) || typeof value !== 'string'
    )
  )
    fail('INVALID_QUERY')
  const { q, status, stage, applicationStatus, positionId, limit = '50', offset = '0' } = query
  if (
    (q !== undefined && (!q.trim() || q.length > 200 || q.includes('\0'))) ||
    (status !== undefined && !['open', 'closed'].includes(status)) ||
    (stage !== undefined &&
      !['screening', 'first_interview', 'second_interview', 'offer'].includes(stage)) ||
    (applicationStatus !== undefined && !['active', 'closed'].includes(applicationStatus))
  )
    fail('INVALID_QUERY')
  return {
    q: q?.trim(),
    status,
    stage,
    applicationStatus,
    positionId: positionId === undefined ? undefined : integer(positionId, 1),
    limit: integer(limit, 1, 100),
    offset: integer(offset, 0)
  }
}

const commandRequest = (req, command, fields, idParameter) => {
  if (!req.is('application/json')) fail('UNSUPPORTED_MEDIA_TYPE')
  const key = req.get('Idempotency-Key')
  if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key) || key.includes(','))
    fail('INVALID_IDEMPOTENCY_KEY')
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST')
  const entries = Object.entries(body)
  if (
    entries.some(
      ([field]) => !Object.hasOwn(fields, field) && !(idParameter && field === 'expectedVersion')
    )
  )
    fail('INVALID_FIELDS')
  const payload = Object.fromEntries(
    entries
      .filter(([field]) => field !== 'expectedVersion')
      .map(([field, value]) => [fields[field], value])
  )
  const request = { command, payload, idempotencyKey: key }
  if (idParameter) {
    request.aggregateId = integer(req.params[idParameter], 1)
    const version = body.expectedVersion
    if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)
      fail('INVALID_VERSION')
    request.expectedVersion = version
  }
  return request
}

export const createV3RecruitingRoutes = ({ db, requireAuth, requireRecruiting, resolveActor }) => {
  const router = Router()
  const service = createRecruitingService({ db, resolveActor })
  router.use(['/positions', '/applications'], requireAuth, requireRecruiting)

  const read = (handler) => (req, res) => res.json(handler(req, res.locals.v3ActorContext))
  const page = (method, resource, dto) =>
    read((req, actor) => {
      const result = method(actor, options(req.query, resource))
      return { ...result, items: result.items.map(dto) }
    })
  const write = (command, fields, idParameter) => (req, res) => {
    const response = service.execute(
      res.locals.v3ActorContext,
      commandRequest(req, command, fields, idParameter)
    )
    res.status(!idParameter && !response.replayed ? 201 : 200).json(response)
  }

  router.get('/positions', page(service.positionsPage, 'positions', positionDto))
  router.get(
    '/positions/options',
    read((_req, actor) => service.positionOptions(actor))
  )
  router.get(
    '/positions/:positionId',
    read((req, actor) =>
      positionDto(service.positionDetail(actor, integer(req.params.positionId, 1)))
    )
  )
  router.post('/positions', write('position.create', positionFields))
  router.patch('/positions/:positionId', write('position.update', positionFields, 'positionId'))
  router.post(
    '/positions/:positionId/status',
    write('position.status', { status: 'status' }, 'positionId')
  )
  router.post('/positions/:positionId/archive', write('position.delete', {}, 'positionId'))

  router.get('/applications', page(service.applicationsPage, 'applications', applicationDto))
  router.get(
    '/applications/:applicationId',
    read((req, actor) =>
      applicationDetailDto(service.applicationDetail(actor, integer(req.params.applicationId, 1)))
    )
  )
  router.post(
    '/applications',
    write('application.create', { ...applicationFields, positionId: 'position_id' })
  )
  router.patch(
    '/applications/:applicationId',
    write('application.update', applicationFields, 'applicationId')
  )

  return router
}
