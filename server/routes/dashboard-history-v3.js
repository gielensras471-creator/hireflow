import { Router } from 'express'
import { createDashboardService } from '../services/dashboard-service.js'
import { createHistoryService } from '../services/history-service.js'
import { fail, integer } from './request-v3.js'
import { historyEventDto, historicalMissingDto, legacyRecordDto } from './history-v3-dto.js'

const workTypes = ['screening', 'scheduling', 'due', 'feedback', 'decision', 'offer']
const offerStatuses = ['preparing', 'sent', 'accepted']

const queryFields = (query, allowed) => {
  if (
    Object.entries(query).some(
      ([key, value]) => !allowed.includes(key) || typeof value !== 'string'
    )
  )
    fail('INVALID_QUERY')
}
const pageOptions = (query) => {
  queryFields(query, ['limit', 'offset'])
  return {
    limit: integer(query.limit ?? '50', 1, 100),
    offset: integer(query.offset ?? '0', 0, 100_000)
  }
}
const historyOptions = (query) => {
  queryFields(query, ['limit', 'eventType', 'afterOccurredAt', 'afterEventId'])
  const { limit = '50', eventType, afterOccurredAt, afterEventId } = query
  if ((afterOccurredAt === undefined) !== (afterEventId === undefined)) fail('INVALID_QUERY')
  return {
    limit: integer(limit, 1, 100),
    eventType,
    ...(afterOccurredAt === undefined
      ? {}
      : {
          after: { occurredAt: integer(afterOccurredAt, 0), eventId: integer(afterEventId, 1) }
        })
  }
}
const legacyKey = (query) => {
  queryFields(query, ['sourceKey', 'entityType', 'legacyId'])
  const { sourceKey, entityType, legacyId } = query
  if (
    !sourceKey?.trim() ||
    sourceKey.length > 128 ||
    !['positions', 'candidates', 'interviews'].includes(entityType) ||
    typeof legacyId !== 'string' ||
    !/^(0|-?[1-9]\d*)$/.test(legacyId) ||
    !Number.isSafeInteger(Number(legacyId))
  )
    fail('INVALID_QUERY')
  return { sourceKey, entityType, legacyId: Number(legacyId) }
}

const sourceDto = (row) => ({
  applicationId: row.candidateId,
  positionId: row.positionId,
  stage: row.stage,
  applicationStatus: row.applicationStatus,
  offerStatus: row.offerStatus,
  interviewId: row.interviewId
})
const interviewFacts = (row) => ({
  stageScope: row.stageScope,
  interviewStatus: row.interviewStatus,
  scheduledAt: row.scheduledAt,
  completedAt: row.completedAt,
  cancelledAt: row.cancelledAt
})
const workPageDto = (result, options) => ({
  type: result.type,
  unit: result.unit,
  total: result.total,
  pageCount: result.pageCount,
  ...options,
  items: result.items.map((row) => ({
    ...sourceDto(row),
    ...(row.interviewId === null ? {} : interviewFacts(row)),
    type: row.type,
    businessTime: row.businessTime,
    businessTimeKind: row.businessTimeKind,
    hint: row.hint
  }))
})

export const createV3DashboardHistoryRoutes = ({
  db,
  requireAuth,
  requireRecruiting,
  resolveActor
}) => {
  const router = Router()
  const dashboard = createDashboardService({ db, resolveActor })
  const history = createHistoryService({ db, resolveActor })
  const read = (handler) => [
    requireAuth,
    requireRecruiting,
    (req, res) => res.json(handler(req, res.locals.v3ActorContext))
  ]

  router.get(
    '/dashboard/summary',
    read((req, actor) => {
      queryFields(req.query, [])
      return dashboard.summary(actor)
    })
  )
  router.get(
    '/dashboard/work-items/:type',
    read((req, actor) => {
      const { type } = req.params
      if (!workTypes.includes(type)) fail('INVALID_QUERY')
      const options = pageOptions(req.query)
      return workPageDto(dashboard.workItems(actor, type, options), options)
    })
  )
  router.get(
    '/dashboard/offer-work-items/:status',
    read((req, actor) => {
      const { status } = req.params
      if (!offerStatuses.includes(status)) fail('INVALID_QUERY')
      const options = pageOptions(req.query)
      return workPageDto(dashboard.offerWorkItems(actor, status, options), options)
    })
  )
  router.get(
    '/dashboard/today-interviews',
    read((req, actor) => {
      const { items, ...page } = dashboard.todayInterviews(actor, pageOptions(req.query))
      return {
        ...page,
        items: items.map((row) => ({
          ...sourceDto(row),
          ...interviewFacts(row),
          due: row.due,
          hint: row.hint
        }))
      }
    })
  )

  router.get(
    '/applications/:applicationId/history',
    read((req, actor) => {
      const { candidateId, currentPosition, items, nextCursor } = history.byApplication(
        actor,
        integer(req.params.applicationId, 1),
        historyOptions(req.query)
      )
      return {
        applicationId: candidateId,
        currentPosition: { positionId: currentPosition.positionId, title: currentPosition.title },
        items: items.map(historyEventDto),
        nextCursor
      }
    })
  )
  router.get(
    '/positions/:positionId/history',
    read((req, actor) => {
      const { positionId, items, nextCursor } = history.byPosition(
        actor,
        integer(req.params.positionId, 1),
        historyOptions(req.query)
      )
      return { positionId, items: items.map(historyEventDto), nextCursor }
    })
  )
  router.get(
    '/applications/:applicationId/historical-missing',
    read((req, actor) => {
      queryFields(req.query, [])
      return history
        .historicalMissing(actor, integer(req.params.applicationId, 1))
        .map(historicalMissingDto)
    })
  )
  router.get(
    '/legacy-records',
    read((req, actor) => legacyRecordDto(history.legacyRecord(actor, legacyKey(req.query))))
  )

  return router
}
