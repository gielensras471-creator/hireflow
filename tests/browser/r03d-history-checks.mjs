import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export async function runR03D({
  create,
  advance,
  book,
  submitApi,
  apiGet,
  apiPost,
  detailPage,
  button,
  evaluate,
  send,
  check,
  width,
  snapshot,
  db,
  output,
  closed,
  closedMeeting,
  setDialogMode,
  httpWriteCount,
  setHistoryError
}) {
  const app = await create('R03-D 长修订链（虚构）')
  await detailPage(app)
  await snapshot('history-empty-sources')
  await advance(app)
  const meeting = await book(app)
  assert.equal((await submitApi(app, meeting)).status, 201)
  const logs = []
  const scope = 'document.querySelector(".v3-feedback-history")'
  const visible =
    '[...document.querySelectorAll("[data-feedback-event]")].filter(e=>e.getClientRects().length)'
  for (let revision = 0; revision <= 6; revision++) {
    if (revision) {
      const a = await apiGet('/applications/' + app),
        f = (await apiGet('/applications/' + app + '/feedback'))[0]
      assert.equal(
        (
          await apiPost('/applications/' + app + '/interviews/' + meeting + '/feedback/correct', {
            expectedVersion: a.version,
            feedbackRevision: f.revision,
            reviewerName: '专业评价人（虚构）',
            recommendation: revision % 2 ? 'undecided' : 'recommend',
            reason:
              '修订' +
              revision +
              '完整理由（虚构）' +
              (process.env.R03_E === '1' ? '长原因与原始快照验证。'.repeat(40) : ''),
            correctionReason: '第' + revision + '次真实核对'
          })
        ).status,
        200
      )
    }
    await detailPage(app)
    await button('查看面评历史', 'document.querySelector(".v3-feedback-card")')
    await check('!!' + scope, 'history read')
    const f = (await apiGet('/applications/' + app + '/feedback'))[0]
    const rows = await apiGet('/applications/' + app + '/feedback/' + f.id + '/history')
    const expected = [...rows]
      .sort((a, b) => b.occurredAt - a.occurredAt || b.eventId - a.eventId)
      .map((e) => e.eventId)
    assert.deepEqual(
      await evaluate(visible + '.map(e=>Number(e.dataset.feedbackEvent))'),
      expected.slice(0, 3)
    )
    assert.equal(await evaluate(scope + '.querySelectorAll("details[open]").length'), 0)
    logs.push({
      events: rows.length,
      eventIds: expected,
      visible: expected.slice(0, 3),
      sameTime: new Set(rows.map((e) => e.occurredAt)).size === 1
    })
    if ([0, 2, 3, 6].includes(revision)) await snapshot('feedback-history-' + rows.length)
  }
  const current = (await apiGet('/applications/' + app + '/feedback'))[0]
  await button('查看本组全部（7 条）', scope)
  assert.equal(await evaluate(visible + '.length'), 7)
  const completeEvents = await apiGet(
    '/applications/' + app + '/feedback/' + current.id + '/history'
  )
  const expandedEventIds = []
  for (const event of completeEvents) {
    const selector = '[data-feedback-event="' + event.eventId + '"]'
    await evaluate(
      'document.querySelector(' + JSON.stringify(selector) + ').querySelector("summary").click()'
    )
    assert.equal(
      await evaluate('document.querySelector(' + JSON.stringify(selector) + ').open'),
      true
    )
    const content = await evaluate(
      'document.querySelector(' + JSON.stringify(selector) + ').textContent'
    )
    for (const fact of [event.before, event.after])
      if (fact) {
        assert.ok(content.includes(fact.reason))
        assert.ok(content.includes(String(fact.revision)))
      }
    expandedEventIds.push(event.eventId)
    await evaluate(
      'document.querySelector(' + JSON.stringify(selector) + ').querySelector("summary").click()'
    )
  }
  const writeBefore = httpWriteCount(),
    counts = {
      ...db
        .prepare(
          'SELECT (SELECT count(*) FROM business_events) e,(SELECT count(*) FROM command_receipts) r'
        )
        .get()
    }
  const url = await evaluate('location.href')
  await button('更正面评', 'document.querySelector(".v3-feedback-card")')
  await check(
    '!!document.querySelector(".v3-feedback-editor [aria-label=推荐依据]")',
    'asynchronous correction editor ready'
  )
  await evaluate(
    '(()=>{const e=document.querySelector("[aria-label=推荐依据]");e.value="历史展开期间保留真实草稿";e.dispatchEvent(new Event("input",{bubbles:true}))})()'
  )
  const editorUid = await evaluate(
    'document.querySelector(".v3-feedback-editor").__vueParentComponent.uid'
  )
  const key = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      ...(key === ' ' ? { text: ' ' } : key === 'Enter' ? { text: '\r' } : {})
    })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk })
  }
  await evaluate(scope + '.querySelector("summary").focus()')
  await key(' ', 'Space', 32)
  await check(scope + '.querySelector("details").open', 'native evidence expansion')
  assert.ok(await evaluate(scope + '.textContent.includes("修订6完整理由")'))
  await snapshot('history-full-snapshots-and-draft')
  // Focus in the older part of the expanded list, then explicitly collapse to the same control.
  await evaluate(
    scope +
      '.querySelectorAll("summary")[6].focus();' +
      scope +
      '.querySelector(".v3-history-toggle").click()'
  )
  await check(
    'document.activeElement.classList.contains("v3-history-toggle")',
    'collapse restores focus'
  )
  assert.equal(await evaluate(visible + '.length'), 3)
  await key('Enter', 'Enter', 13)
  await check(visible + '.length===7', 'keyboard expands all')
  for (const size of [390, 1100, 1440]) {
    await width(size)
    await snapshot('history-layout-' + size)
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
    assert.equal(
      await evaluate('document.querySelector(".v3-feedback-editor").__vueParentComponent.uid'),
      editorUid
    )
  }
  assert.equal(
    await evaluate('document.querySelector("[aria-label=推荐依据]").value'),
    '历史展开期间保留真实草稿'
  )
  assert.equal(await evaluate('location.href'), url)
  assert.equal(httpWriteCount(), writeBefore)
  assert.deepEqual(
    {
      ...db
        .prepare(
          'SELECT (SELECT count(*) FROM business_events) e,(SELECT count(*) FROM command_receipts) r'
        )
        .get()
    },
    counts
  )
  if (process.env.R03_E === '1') {
    await evaluate(
      'document.querySelector(".v3-recruiting").__vueParentComponent.setupState.load()'
    )
    await check(
      'document.querySelector(".v3-recruiting").__vueParentComponent.setupState.refreshPending',
      'history draft defers parent refresh'
    )
    await button('收起本组全部（7 条）', scope)
    await button('查看本组全部（7 条）', scope)
    assert.equal(
      await evaluate('document.querySelector(".v3-feedback-editor").__vueParentComponent.uid'),
      editorUid
    )
    await snapshot('r03e-history-draft-parent-refresh')
  }
  setDialogMode(true)
  await button('返回', 'document.querySelector(".v3-feedback-editor")')
  await check('!document.querySelector(".v3-feedback-editor")', 'draft editor closes normally')
  setDialogMode(true)
  const otherHistory = await evaluate(
    'document.querySelector("[data-detail-history=advancement]").textContent'
  )
  for (const status of [503, 403]) {
    setHistoryError(status)
    await button('查看面评历史', 'document.querySelector(".v3-feedback-card")')
    await check(
      'document.querySelector(".v3-feedback-panel").textContent.includes("暂时无法查看历史")',
      'history error ' + status
    )
    assert.equal(
      await evaluate('document.querySelector("[data-detail-history=advancement]").textContent'),
      otherHistory
    )
    await snapshot('history-error-' + status)
    setHistoryError(null)
    await button('重试历史', 'document.querySelector(".v3-feedback-panel")')
    await check('!!document.querySelector(".v3-feedback-history")', 'history retry ' + status)
  }
  assert.equal(httpWriteCount(), writeBefore)
  await writeFile(
    join(output, 'r03d-history.json'),
    JSON.stringify(
      {
        passed: true,
        history503And403Retry: true,
        otherHistoryPreserved: true,
        applicationId: app,
        feedbackId: current.id,
        revisionChain: logs,
        expandedEventIds,
        editorUid,
        urlStable: true,
        keyboard: ['Space', 'Enter'],
        focusRestored: true,
        httpWritesAdded: 0,
        counts,
        limitations: [
          'no real device/screen reader',
          'advancement has at most 3 legal transitions; no fabricated 4+ history',
          'Offer legal lifecycle bounded; 4+ only tested for feedback'
        ]
      },
      null,
      2
    ) + '\n'
  )
  await detailPage(closed)
}
