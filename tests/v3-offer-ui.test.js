import assert from 'node:assert/strict'
import test from 'node:test'
import {
  offerAllowed,
  sameOfferIntent,
  actionPath,
  offerStatuses,
  outcomes
} from '../src/api/offer-v3.ts'
test('Offer permissions follow server per-action flags, not a blanket appointment gate', () => {
  const c = {
    offer: {
      pendingInterviews: [{ interviewId: 1 }],
      actions: {
        send: { allowed: true },
        accept: { allowed: true },
        decline: { allowed: false },
        confirmHire: { allowed: false }
      }
    },
    closure: { allowed: false }
  }
  assert.equal(offerAllowed(c, 'send'), true)
  assert.equal(offerAllowed(c, 'accept'), true)
  for (const a of ['decline', 'confirmHire', 'close']) assert.equal(offerAllowed(c, a), false)
})
test('conflict retries retain original lifecycle and Offer premise; version change alone is not a new action', () => {
  const a = {
    state: {
      stage: 'offer',
      applicationStatus: 'active',
      offerStatus: 'preparing',
      outcome: null,
      version: 1
    }
  }
  assert.equal(sameOfferIntent(a, { state: { ...a.state, version: 2 } }), true)
  assert.equal(sameOfferIntent(a, { state: { ...a.state, offerStatus: 'sent' } }), false)
  assert.equal(
    sameOfferIntent(a, { state: { ...a.state, applicationStatus: 'closed', outcome: 'hired' } }),
    false
  )
})
test('dedicated action paths and accepted/outcome labels preserve domain distinction', () => {
  assert.equal(actionPath(1, 'decline'), '/applications/1/offer/decline')
  assert.equal(actionPath(1, 'confirmHire'), '/applications/1/offer/confirm-hire')
  assert.equal(actionPath(1, 'close'), '/applications/1/close')
  assert.match(offerStatuses.accepted, /待 HR 确认/)
  assert.equal(outcomes.hired, '已录用')
})
