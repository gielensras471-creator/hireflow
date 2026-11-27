// The test runs the same business actions through the visible application workspace.
export async function showDetailTabForScope(evaluate, scope) {
  const groups = {
    interviews: /v3-interview|v3-feedback|data-interview-id|data-feedback-interview/,
    decision: /v3-advanc|v3-advance/,
    offer: /v3-offer/
  }
  const entry = Object.entries(groups).find(([, pattern]) => pattern.test(scope))
  if (!entry) return
  await evaluate(`(() => {
    const button = document.querySelector('[data-detail-tab="${entry[0]}"]')
    if (button && button.getAttribute('aria-selected') === 'false') button.click()
  })()`)
}
