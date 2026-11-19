import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function runR03C({
  evaluate,
  send,
  check,
  width,
  button,
  detailPage,
  fillReview,
  output,
  apiGet,
  apiPost,
  main,
  meeting,
  closed,
  closedMissing,
  create,
  advance,
  book,
  db,
  httpWriteCount,
  setDialogMode,
  setLegacyProjection
}) {
  const log = []
  const counts = () => ({
    ...db
      .prepare(
        'SELECT (SELECT count(*) FROM business_events) events,(SELECT count(*) FROM command_receipts) receipts'
      )
      .get()
  })
  const record = async (name) => {
    const m = await send('Page.getLayoutMetrics')
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: m.cssContentSize.width, height: m.cssContentSize.height, scale: 1 }
    })
    await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
  }
  const keyboard = async (key, code, virtualKey, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      modifiers,
      ...(key === 'Enter'
        ? { text: '\r', unmodifiedText: '\r' }
        : key === ' '
          ? { text: ' ', unmodifiedText: ' ' }
          : {}),
      key,
      code,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers,
      key,
      code,
      windowsVirtualKeyCode: virtualKey,
      nativeVirtualKeyCode: virtualKey
    })
  }
  const ids = () =>
    evaluate(
      'Object.fromEntries([".v3-interviews",".v3-feedback-panel",".v3-advancement",".v3-offer"].map(s=>[s,document.querySelector(s).__vueParentComponent.uid]))'
    )
  const editor = 'document.querySelector(".v3-feedback-editor")'
  const toggle = 'document.querySelector(".v3-profile-toggle")'
  const full = {
    skills: '完整技能（虚构）'.repeat(90),
    experience: '第一段经历（虚构）\n' + '很长的工作经历且不能截断。'.repeat(80),
    note: '业务判断备注（虚构）\n' + '保留所有原始文字。'.repeat(80),
    education: '',
    school: '',
    phone: '',
    email: ''
  }
  const a = await apiGet('/applications/' + main)
  assert.equal(
    (await apiPost('/applications/' + main, { ...full, expectedVersion: a.version }, 'PATCH'))
      .status,
    200
  )
  const roundsApp = await create('R03-C 双轮次优先（虚构）')
  await advance(roundsApp)
  const pastMeeting = await book(roundsApp)
  await advance(roundsApp)
  const currentMeeting = await book(roundsApp)
  await detailPage(main)
  const before = counts()
  const writesBefore = httpWriteCount()
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile Shell settled')
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await evaluate('window.scrollTo(0,0)')
  const metrics = await evaluate(
    '(()=>{const task=document.querySelector(".v3-detail-task"),identity=document.querySelector(".v3-detail-summary h2");return {taskBottom:task.getBoundingClientRect().bottom,identityTop:identity.getBoundingClientRect().top,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}})()'
  )
  if (metrics.taskBottom > 844) console.log('R03C mobile metrics', metrics)
  assert.ok(metrics.taskBottom <= 844, '390x844 current task and action must be visible')
  assert.ok(metrics.identityTop >= 0)
  assert.ok(metrics.scrollWidth <= 390)
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-detail-main .el-button")].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)'
    ),
    'mobile task buttons have 44px touch height'
  )
  const order = await evaluate(
    '[".v3-interviews",".v3-feedback-panel",".v3-advancement",".v3-offer",".v3-detail-aside",".v3-detail-history-entry"].map(s=>({selector:s,top:document.querySelector(s).getBoundingClientRect().top+scrollY}))'
  )
  for (let i = 1; i < order.length; i++)
    assert.ok(order[i].top > order[i - 1].top, 'mobile task-first order')
  await record('mobile-390-task-first')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  })
  assert.ok(
    await evaluate('document.querySelector(".v3-detail-task").getBoundingClientRect().bottom<=900')
  )
  await record('mobile-390x900')
  log.push({ case: 'mobile first screen/order', metrics, order })
  await button(
    '填写面评',
    'document.querySelector("[data-feedback-interview=\\"' + meeting + '\\"]")'
  )
  await fillReview('R03-C 原实例真实未保存草稿')
  const uid = await evaluate(editor + '.__vueParentComponent.uid')
  const panelIds = await ids()
  const url = await evaluate('location.href')
  for (const size of [1440, 390, 1100, 1440]) {
    await width(size)
    for (let i = 0; i < 6; i++) {
      await evaluate('document.querySelectorAll(".v3-detail-navigation button")[' + i + '].focus()')
      await keyboard('Enter', 'Enter', 13)
      try {
        await check(
          '["H2","H3"].includes(document.activeElement?.tagName)',
          'anchor heading focus ' + size + '/' + i
        )
      } catch (e) {
        console.log(
          'R03C focus diagnostic',
          await evaluate(
            '({tag:document.activeElement?.tagName,text:document.activeElement?.textContent,focus:document.hasFocus(),message:document.querySelector(".v3-detail-navigation-message")?.textContent})'
          )
        )
        throw e
      }
      const focusPosition = await evaluate(
        '({top:document.activeElement.getBoundingClientRect().top,heading:document.activeElement.textContent,scrollY})'
      )
      if (focusPosition.top < 0) console.log('R03C position', { size, i, ...focusPosition })
      assert.ok(focusPosition.top >= 0, 'focused heading not obscured')
      assert.equal(await evaluate('location.href'), url)
      assert.equal(await evaluate(editor + '.__vueParentComponent.uid'), uid)
    }
    assert.deepEqual(await ids(), panelIds)
    assert.equal(
      await evaluate('document.querySelector("[aria-label=推荐依据]").value'),
      'R03-C 原实例真实未保存草稿'
    )
    assert.equal(
      await evaluate(
        'document.querySelectorAll(".v3-interviews,.v3-feedback-panel,.v3-advancement,.v3-offer").length'
      ),
      4
    )
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
    await evaluate('window.scrollTo(0,0)')
    await record('layout-' + size)
    log.push({ case: 'resize/navigation', size, uid, panelIds, urlUnchanged: true })
  }
  await evaluate('document.querySelectorAll(".v3-detail-navigation button")[0].focus()')
  await keyboard('Tab', 'Tab', 9)
  assert.equal(
    await evaluate(
      'document.activeElement===document.querySelectorAll(".v3-detail-navigation button")[1]'
    ),
    true
  )
  await keyboard('Tab', 'Tab', 9, 8)
  assert.equal(
    await evaluate(
      'document.activeElement===document.querySelectorAll(".v3-detail-navigation button")[0]'
    ),
    true
  )
  await keyboard('Tab', 'Tab', 9)
  await keyboard(' ', 'Space', 32)
  assert.equal(await evaluate('document.activeElement.tagName'), 'H2')
  await evaluate(toggle + '.focus()')
  await keyboard(' ', 'Space', 32)
  await check(toggle + '.getAttribute("aria-expanded")==="true"', 'Space expands readonly profile')
  const text = await evaluate('document.querySelector("#v3-extra-profile").textContent')
  for (const key of ['skills', 'experience', 'note'])
    assert.ok(text.includes(full[key]), 'full original ' + key)
  assert.ok(text.includes('未记录'))
  assert.equal(
    await evaluate('document.querySelector(".v3-detail-aside").textContent.includes("未提供")'),
    true
  )
  assert.equal(
    await evaluate(
      'document.querySelector("#v3-extra-profile").querySelector("form,input,textarea")'
    ),
    null
  )
  await width(390)
  await record('profile-long-expanded-390')
  await evaluate('document.querySelector("#v3-extra-profile dd").focus()')
  await keyboard('Escape', 'Escape', 27)
  await check(
    toggle + '.getAttribute("aria-expanded")==="false" && document.activeElement===' + toggle,
    'Escape collapse restores control focus'
  )
  await keyboard('Enter', 'Enter', 13)
  await check(toggle + '.getAttribute("aria-expanded")==="true"', 'Enter reopens')
  await evaluate('document.querySelector("#v3-extra-profile dd").focus();' + toggle + '.click()')
  await check(
    toggle + '.getAttribute("aria-expanded")==="false" && document.activeElement===' + toggle,
    'collapse with focused content restores control focus'
  )
  assert.equal(await evaluate(editor + '.__vueParentComponent.uid'), uid)
  assert.equal(
    await evaluate('document.querySelector("[aria-label=推荐依据]").value'),
    'R03-C 原实例真实未保存草稿'
  )
  assert.equal(await evaluate('location.href'), url)
  assert.deepEqual(counts(), before, 'anchors, folding and resizing do not write events/receipts')
  assert.equal(httpWriteCount(), writesBefore, 'navigation, resize and folding send no HTTP writes')
  log.push({
    case: 'keyboard/folding',
    keys: ['Tab', 'Shift+Tab', 'Space', 'Escape', 'Enter'],
    realCdpInput: true,
    fullTextVerified: true,
    focusRestored: true,
    editorUid: uid,
    countsBefore: before,
    countsAfter: counts()
  })
  await record('profile-collapsed-focus')
  setDialogMode(true)
  await button('返回', editor)
  await check('!' + editor, 'editor closes normally')
  setDialogMode(null)
  await detailPage(closed)
  await button('查看已有评价与真实历史', 'document.querySelector(".v3-detail-task")')
  assert.equal(await evaluate('!!document.activeElement.closest("[data-existing-feedback]")'), true)
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-detail-navigation-message").textContent.includes("具体更正资格")'
    )
  )
  await record('closed-existing-feedback-navigation')
  log.push({
    case: 'closed existing evaluation',
    actualFeedbackTarget: true,
    noNewEligibilityClaim: true
  })
  await detailPage(closedMissing)
  await button('查看已有评价与真实历史', 'document.querySelector(".v3-detail-task")')
  assert.ok(await evaluate('!!document.activeElement.closest(".v3-detail-history-entry")'))
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-detail-navigation-message").textContent.includes("不能据此认定存在可更正记录")'
    )
  )
  await record('closed-no-feedback-navigation')
  setLegacyProjection(closedMissing)
  await detailPage(closedMissing)
  await button('查看已有评价与真实历史', 'document.querySelector(".v3-detail-task")')
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-detail-summary").textContent.includes("未知，待核实")'
    )
  )
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-detail-summary").textContent.includes("未记录结束结果")'
    )
  )
  assert.ok(await evaluate('!!document.activeElement.closest(".v3-detail-history-entry")'))
  await record('unknown-history-readonly-projection')
  log.push({
    case: 'closed/no feedback/unknown history',
    projection: 'isolated GET response fixture only; no DB constraints changed',
    fabricatedEvents: false
  })
  setLegacyProjection(null)
  await detailPage(main)
  await evaluate('document.querySelector(".v3-detail-history-entry").remove()')
  await evaluate('document.querySelectorAll(".v3-detail-navigation button")[4].click()')
  await check(
    'document.querySelector(".v3-detail-navigation-message")?.textContent.includes("暂不可用")',
    'missing target is explicit'
  )
  log.push({
    case: 'unavailable DOM target',
    fixture: 'test removes readonly target; no simulated successful navigation',
    explicitFeedback: true
  })
  await detailPage(roundsApp)
  await check(
    'document.querySelectorAll(".v3-feedback-card").length===2',
    'both interview rounds read'
  )
  assert.equal(
    await evaluate('Number(document.querySelector("[data-interview-id]").dataset.interviewId)'),
    currentMeeting
  )
  assert.equal(
    await evaluate(
      'Number(document.querySelector("[data-feedback-interview]").dataset.feedbackInterview)'
    ),
    currentMeeting
  )
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("[data-interview-id]")].some(e=>Number(e.dataset.interviewId)===' +
        pastMeeting +
        ')'
    )
  )
  await record('current-round-first-390')
  log.push({ case: 'current round first', pastMeeting, currentMeeting, historyStillPresent: true })
  await detailPage(main)
  await width(1440)
  assert.deepEqual(counts(), before)
  assert.equal(httpWriteCount(), writesBefore)
  await writeFile(
    join(output, 'r03c-keyboard-lifecycle.json'),
    JSON.stringify(
      {
        passed: true,
        log,
        limitations: [
          'no hardware touch/screen reader',
          'unknown legacy fields are explicitly isolated response projection',
          'six business regression scripts cover 403/409/401 and uncertain replay separately'
        ]
      },
      null,
      2
    ) + '\n'
  )
}
