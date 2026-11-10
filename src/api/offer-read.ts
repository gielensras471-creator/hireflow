import { readV3 } from './request-v3'
import type { Application } from './recruiting-v3'
import type { OfferState, OfferPreflight, ClosurePreflight, OfferContext } from './offer-v3'
export async function readOfferContext(id: number): Promise<OfferContext> {
  const p = '/applications/' + id
  const [profile, state, offer, closure] = await Promise.all([
    readV3<Application>(p),
    readV3<OfferState>(p + '/offer'),
    readV3<OfferPreflight>(p + '/offer/preflight'),
    readV3<ClosurePreflight>(p + '/closure/preflight')
  ])
  // Refuse a mixed-version bundle; never decide using inconsistent concurrent GET results.
  if (
    state.version !== offer.application.version ||
    state.version !== closure.application.version ||
    state.version !== profile.version
  )
    throw new Error('记录已有新进展，请重新读取状态。')
  return { profile, state, offer, closure }
}
