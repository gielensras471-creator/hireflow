import { readV3 } from './request-v3'
import type { Application } from './recruiting-v3'
import type { Interview } from './interview-v3'
import type { Eligibility, FeedbackRecord, FeedbackEvent } from './feedback-v3'

export async function readFeedbackContext(id: number) {
  const base = '/applications/' + id
  const [application, interviews, feedback, historical] = await Promise.all([
    readV3<Application>(base),
    readV3<Interview[]>(base + '/interviews'),
    readV3<FeedbackRecord[]>(base + '/feedback'),
    readV3<Eligibility[]>(base + '/historical-missing')
  ])
  const eligibility = await Promise.all(
    interviews.map((meeting) =>
      readV3<Eligibility>(base + '/interviews/' + meeting.id + '/supplement-eligibility')
    )
  )
  return { application, interviews, feedback, historical, eligibility }
}
export type FeedbackContext = Awaited<ReturnType<typeof readFeedbackContext>>
export async function readFeedbackHistory(id: number, feedbackId: number) {
  const base = '/applications/' + id
  const items = await readV3<FeedbackEvent[]>(base + '/feedback/' + feedbackId + '/history')
  const decisions: Record<number, number> = {}
  // The dedicated feedback DTO attests to prior advancement; the business history DTO also
  // attests to closure. Page only correction events; never infer a decision from current stage.
  if (items.some((event) => event.eventType === 'feedback_corrected')) {
    let cursor: { occurredAt: number; eventId: number } | null = null
    do {
      const query = new URLSearchParams({ limit: '100', eventType: 'feedback_corrected' })
      if (cursor) {
        query.set('afterOccurredAt', String(cursor.occurredAt))
        query.set('afterEventId', String(cursor.eventId))
      }
      const page: {
        items: {
          eventId: number
          feedbackId: number
          priorDecisions: { advancementEventId: number | null; closureEventId: number | null }
        }[]
        nextCursor: { occurredAt: number; eventId: number } | null
      } = await readV3(base + '/history?' + query)
      for (const event of page.items) {
        const decision =
          event.priorDecisions.closureEventId ?? event.priorDecisions.advancementEventId
        if (event.feedbackId === feedbackId && decision) decisions[event.eventId] = decision
      }
      cursor = page.nextCursor
    } while (cursor)
  }
  return { items, decisions }
}
