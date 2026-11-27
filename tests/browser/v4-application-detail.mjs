import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDemoServer } from '../../server/index-demo-v3.js'
const output = process.argv[2]
if (!output) throw new Error('Provide a new DEV-04 evidence directory')
await mkdir(output, { recursive: false })
const profile = await mkdtemp(join(tmpdir(), 'hireflow-demo-chrome-'))
const password = 'a123456'
const running = await startDemoServer({ port: 0, staticDir: process.argv[3] })
const db = running.db
const app = {
  username: 'demo_admin',
  password,
  url: 'http://127.0.0.1:' + running.server.address().port
}
const consoleErrors = [],
  networkFailures = []
const browserExceptions = [],
  httpEvidence = []
const chrome = spawn(
  process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
  ],
  { windowsHide: true, stdio: 'ignore' }
)
let ws
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, label, ms = 25000) {
  const end = performance.now() + ms
  let last
  while (performance.now() < end) {
    try {
      const value = await fn()
      if (value) return value
    } catch (e) {
      last = e
    }
    await sleep(100)
  }
  throw new Error(label + (last ? ': ' + last.message : ''))
}
const requests = []
const meStatuses = []
const pending = new Map()
let seq = 0
let dialogMode = null
let handledDialogs = 0
const shellChecks = []
const loginChecks = []
function send(method, params = {}, sessionId) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  })
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed')
  return result.result.value
}
const check = (expr, label) => until(() => evaluate(expr), label)
const h1 = (name) =>
  check('document.querySelector("h1")?.textContent === ' + JSON.stringify(name), name)
const click = (selector) =>
  evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.click()')
const go = (path) => send('Page.navigate', { url: app.url + path })
const key = async (name, code) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      text: type === 'keyDown' && name === 'Enter' ? String.fromCharCode(13) : undefined
    })
  }
}
const width = (w) =>
  send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: w < 800 ? 844 : 900,
    deviceScaleFactor: 1,
    mobile: false
  })
async function snapshot(name) {
  const metrics = await send('Page.getLayoutMetrics')
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: metrics.cssContentSize.width,
      height: metrics.cssContentSize.height,
      scale: 1
    }
  })
  await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
}
async function loginViewportSnapshot(name) {
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  )
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
}
async function fill(password, remember = false) {
  await evaluate(
    '(() => { const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}))};set("v3-username",' +
      JSON.stringify(app.username) +
      ');set("v3-password",' +
      JSON.stringify(password) +
      ');if(' +
      remember +
      '&&!document.querySelector("input[type=checkbox]").checked)document.querySelector("input[type=checkbox]").click();document.querySelector("form").requestSubmit()})()'
  )
}

const fixture = db
  .prepare(
    `SELECT c.id FROM candidates c JOIN interviews i ON i.candidate_id=c.id
  LEFT JOIN feedback f ON f.interview_id=i.id
  WHERE c.application_status='active' AND i.stage_scope=c.stage AND i.status='completed' AND f.id IS NULL ORDER BY c.id LIMIT 1`
  )
  .get()
const path = '/candidates/' + fixture.id
const boardLink = '[data-application-link="' + fixture.id + '"]'
const tab = (name) => click('[data-detail-tab="' + name + '"]')
const selector = (name) => '[data-detail-tab="' + name + '"]'
const confirmTexts = []
const dialogTypes = []
let confirmMode = false
let rejectedHistory = false
let historyOverlap = null
let readStatus = 0
let generalReads = 0
let stageReads = 0
const historyQueries = []
const cases = {}
const view = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

const scrollState = () => evaluate(`(() => {
  const get = (selector) => document.querySelector(selector);
  const shell = get('.v3-content'), profile = get('.v3-detail-aside'), bar = get('.v4-detail-tabbar');
  const top = (element) => element.getBoundingClientRect().top;
  return {
    shellTop: top(shell), shellPadding: parseFloat(getComputedStyle(shell).paddingTop),
    scrollTop: shell.scrollTop, max: shell.scrollHeight - shell.clientHeight,
    inset: parseFloat(getComputedStyle(bar).top), left: top(profile), tabs: top(bar),
    profilePosition: getComputedStyle(profile).position,
    headingBottom: get('.v4-detail-heading').getBoundingClientRect().bottom,
    progressBottom: get('.v4-progress').getBoundingClientRect().bottom,
    paneOverflow: getComputedStyle(get('.v4-detail-pane')).overflowY,
    paneScrollTop: get('.v4-detail-pane').scrollTop,
    mask: getComputedStyle(get('.v4-detail-tabs'), '::before').content !== 'none'
  };
})()`)
const setDetailScroll = (top) =>
  evaluate(`document.querySelector('.v3-content').scrollTop = ${top}`)

async function verifySticky(width) {
  await setDetailScroll(0)
  const initial = await scrollState()
  assert.equal(initial.mask, false)
  const edge = initial.shellTop + initial.shellPadding + initial.inset
  const leftStart = initial.left - edge
  const tabStart = initial.tabs - edge
  assert.ok(leftStart > 0 && tabStart > leftStart)
  await setDetailScroll((leftStart + tabStart) / 2)
  const onlyLeft = await scrollState()
  assert.ok(Math.abs(onlyLeft.left - edge) <= 1 && onlyLeft.tabs > edge + 10, JSON.stringify({ width, initial, onlyLeft }))
  if (width === 1920) await snapshot('01b-left-sticky')
  const point = await reachable('.v4-event-facts summary')
  const beforeWheel = (await scrollState()).scrollTop
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0,
    deltaY: Math.max(120, tabStart + 100 - beforeWheel)
  })
  const both = await until(async () => {
    const state = await scrollState()
    return state.scrollTop > Math.max(tabStart + 16, beforeWheel) && state
  }, 'wheel over content moved main scroll')
  assert.ok(Math.abs(both.left - edge) <= 1 && Math.abs(both.tabs - edge) <= 1, JSON.stringify({ edge, both }))
  assert.ok(both.headingBottom < edge && both.progressBottom < edge)
  assert.equal(both.paneOverflow, 'visible')
  assert.equal(both.paneScrollTop, 0)
  await until(async () => (await scrollState()).mask, 'opaque mask activates when pinned')
  await snapshot('sticky-both-' + width)
  await setDetailScroll(both.max)
  const bottom = await scrollState()
  assert.ok(Math.abs(bottom.scrollTop - bottom.max) <= 1)
  if (width === 1920) await snapshot('detail-scroll-bottom')
  await tab('interviews')
  await check('document.querySelector("[data-detail-tab=interviews]").getAttribute("aria-selected") === "true"', 'shorter tab active')
  assert.ok(await evaluate(`(() => {
    const bar = document.querySelector('.v4-detail-tabbar').getBoundingClientRect();
    const pane = document.querySelector('.v4-detail-pane').getBoundingClientRect();
    return pane.top >= bar.bottom - 1 && pane.top < innerHeight;
  })()`))
  if (width === 1920) {
    await reachable('.v3-feedback-card button', '填写面评')
    await snapshot('sticky-interviews-operations')
  }
  await tab('history')
  await setDetailScroll(0)
  assert.equal((await scrollState()).scrollTop, 0)
  await until(async () => !(await scrollState()).mask, 'mask releases near top')
  return { initial, onlyLeft, both, bottom }
}

async function reachable(selector, text = '') {
  const target = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e =>
    e.getClientRects().length && !e.disabled && e.textContent.includes(${JSON.stringify(text)}))`
  await check(`!!(${target})`, 'rendered action: ' + (text || selector))
  const point = await evaluate(`(() => {
    const element = ${target};
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const {left, top, right, bottom} = element.getBoundingClientRect();
    const x = (left + right) / 2, y = (top + bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === element || element.contains(hit) };
  })()`)
  assert.equal(point.hit, true, 'unobstructed action: ' + (text || selector))
  return point
}

async function checkCompactActions() {
  await reachable('.v4-detail-header-actions button', '编辑申请资料')
  for (const [name, area, action] of [
    ['interviews', '.v3-feedback-card button', '填写面评'],
    ['decision', '.v3-advance-actions button', '核验并决定晋级'],
    ['offer', '.v4-offer-closure button', '结束招聘'],
    ['history', '.v4-event-facts summary', '']
  ]) {
    await reachable(selector(name))
    await tab(name)
    await reachable(area, action)
  }
  await tab('task')
  await reachable('.v4-detail-header-actions button', '刷新详情')
}

async function waitForNativeZoom() {
  await send('Emulation.clearDeviceMetricsOverride')
  const { windowId } = await send('Browser.getWindowForTarget')
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 900 } })
  const { targetInfo: { targetId: mainTab } } = await send('Target.getTargetInfo')
  const { targetId } = await send('Target.createTarget', { url: 'chrome://settings/appearance', background: true })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  try {
    await until(async () => {
      const r = await send('Runtime.evaluate', { expression: 'typeof chrome.settingsPrivate?.setDefaultZoom === "function"', returnByValue: true }, sessionId)
      return r.result?.value === true
    }, 'native browser zoom settings')
    await send('Runtime.evaluate', { expression: 'chrome.settingsPrivate.setDefaultZoom(2)' }, sessionId)
    await send('Target.activateTarget', { targetId: mainTab })
    await send('Page.reload')
    await h1('申请详情')
    await check('devicePixelRatio >= 1.95 && innerWidth < 740 && document.documentElement.scrollWidth <= innerWidth + 1 && !!document.querySelector(".v4-detail-identity")', 'native zoom and layout')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    assert.ok(Buffer.from(data, 'base64').length > 8000)
    await writeFile(join(output, 'detail-native-200.png'), Buffer.from(data, 'base64'))
    await checkCompactActions()
    return await evaluate('({ cssWidth: innerWidth, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth })')
  } finally {
    await send('Runtime.evaluate', { expression: 'chrome.settingsPrivate.setDefaultZoom(1)' }, sessionId)
    await send('Target.closeTarget', { targetId })
  }
}
async function button(text, area = 'document') {
  const expression = `[...${area}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})`
  await check(`!!(${expression}) && !(${expression}).disabled`, text)
  return evaluate(`(${expression}).click()`)
}
const field = (label, value) =>
  evaluate(`(() => {
  const e = document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']')
  e.value = ${JSON.stringify(value)}
  e.dispatchEvent(new Event('input',{bubbles:true}))
})()`)
const fetchFailure = (requestId, status) =>
  send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify({ error: { code: 'FIXTURE_FAILURE' } })).toString('base64')
  })
try {
  const port = await until(
    async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
    'Chrome debugging port'
  )
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  ws = new WebSocket(pages.find(({ type }) => type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.id) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.error) p?.reject(new Error(m.error.message))
      else p?.resolve(m.result)
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      confirmTexts.push(m.params.message)
      dialogTypes.push(m.params.type)
      void send('Page.handleJavaScriptDialog', { accept: confirmMode })
    }
    if (
      m.method === 'Network.requestWillBeSent' &&
      m.params.request.url.includes('/advance/preflight')
    )
      stageReads++
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params
      const url = new URL(request.url)
      if (url.pathname.endsWith('/history')) {
        generalReads++
        historyQueries.push(Object.fromEntries(url.searchParams))
        if (rejectedHistory) {
          rejectedHistory = false
          void fetchFailure(requestId, 503)
          return
        }
        if (historyOverlap && url.searchParams.has('afterEventId')) {
          const body = historyOverlap
          historyOverlap = null
          void send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify(body)).toString('base64')
          })
          return
        }
      } else if (readStatus) {
        const status = readStatus
        readStatus = 0
        void fetchFailure(requestId, status)
        return
      }
      void send('Fetch.continueRequest', { requestId })
    }
  }
  await Promise.all([send('Page.enable'), send('Network.enable'), view(1920, 1080)])
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/api/v3/applications/' + fixture.id },
      { urlPattern: '*/api/v3/applications/' + fixture.id + '/history?*' }
    ]
  })
  await go('/candidates')
  await h1('欢迎回来')
  await fill(password, true)
  await h1('候选人管理')
  const otherId = await check(
    `[...document.querySelectorAll('[data-application-link]')].find(e => e.dataset.applicationLink !== '${fixture.id}')?.dataset.applicationLink`,
    'second application card'
  )
  await click(`[data-application-link="${otherId}"]`)
  await h1('申请详情')
  const row = db.prepare('SELECT stage,position_id FROM candidates WHERE id=?').get(fixture.id)
  await go('/candidates?positionId=' + row.position_id + '&stage=' + row.stage)
  await check(`!!document.querySelector(${JSON.stringify(boardLink)})`, 'filtered card')
  const locationBefore = await evaluate('location.search')
  await click(boardLink)
  await h1('申请详情')
  await check(
    'document.querySelector(".v3-detail-task h3")?.textContent.includes("尚有面评待提交")',
    'current task reflects actual preflight'
  )
  assert.equal(await evaluate('document.querySelectorAll("[data-detail-tab]").length'), 5)
  const designGeometry = await evaluate(`(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
    return {
      viewport: [innerWidth, innerHeight],
      profile: rect('.v3-detail-aside').width,
      workspace: rect('.v4-detail-workspace').width,
      progress: rect('.v4-progress').height,
      stage: rect('.v3-detail-stages li').height,
      taskSurface: rect('.v4-task-lead').width
    }
  })()`)
  assert.ok(designGeometry.profile >= 360 && designGeometry.profile <= 384)
  assert.ok(designGeometry.progress >= 142 && designGeometry.stage >= 70)
  await snapshot('01-current-task-1920')
  await evaluate('document.querySelector("[data-detail-tab=task]").focus()')
  await key('ArrowRight', 39)
  await check(
    'document.activeElement.dataset.detailTab === "interviews" && document.querySelector("[data-detail-tab=task]").getAttribute("aria-selected") === "true"',
    'arrow only moves tab focus'
  )
  await key('Enter', 13)
  await check(
    'document.querySelector("[data-detail-tab=interviews]").getAttribute("aria-selected") === "true"',
    'keyboard activates tab'
  )
  await check('!!document.querySelector(".v3-feedback-card")', 'embedded interview cards')
  designGeometry.meetingSurface = await evaluate('document.querySelector(".v4-meeting-surface").getBoundingClientRect().width')
  await snapshot('02-interviews-feedback-1920')
  const { x, y } = await reachable('.v3-feedback-card button', '填写面评')
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  await check('!!document.querySelector(".v3-feedback-editor")', 'feedback editor')
  await reachable('.v3-feedback-editor textarea')
  await setDetailScroll((await scrollState()).max)
  const editScroll = await scrollState()
  assert.ok(Math.abs(editScroll.left - editScroll.tabs) <= 1 && editScroll.headingBottom < editScroll.left)
  await snapshot('sticky-feedback-editor')
  await field('专业评价人姓名', '虚构测试评价人')
  await field('推荐依据', '保留这段未提交评价')
  const stageBefore = stageReads
  await tab('decision')
  await check(
    'document.querySelector(".v4-detail-notice")?.textContent.includes("有一笔编辑")',
    'draft notice'
  )
  await check(
    '!document.querySelector(".v3-feedback-editor").getClientRects().length',
    'hidden editor remains mounted'
  )
  await check(
    '[...document.querySelectorAll(".v3-advancement button")].find(b=>b.textContent.trim()==="核验并决定晋级").disabled',
    'other editor blocked'
  )
  assert.equal(stageReads, stageBefore)
  await snapshot('draft-preserved-in-another-tab')
  await button('刷新详情')
  await check(
    'document.querySelector(".v4-detail-workspace").textContent.includes("请求结束后将刷新")',
    'refresh queued'
  )
  await button('← 返回候选人管理')
  await until(() => confirmTexts.length >= 1, 'back guard')
  assert.equal(await evaluate('location.pathname'), path)
  await click('.v3-sidebar button[aria-label="退出"]')
  await until(() => confirmTexts.length >= 2, 'logout guard')
  assert.equal(await evaluate('location.pathname'), path)
  const otherTab = `.v3-tabs a[href="/candidates/${otherId}"]`
  await check(`!!document.querySelector(${JSON.stringify(otherTab)})`, 'other application tab')
  await click(otherTab)
  await until(() => confirmTexts.length >= 3, 'switch application guard')
  assert.equal(await evaluate('location.pathname'), path)
  cases.otherApplicationCancel = true
  await button('回到原操作')
  await check(
    'document.querySelector("[aria-label=推荐依据]")?.value === "保留这段未提交评价"',
    'draft and editor restored intact'
  )
  const reload = send('Page.reload')
  await until(() => dialogTypes.includes('beforeunload'), 'native reload prompt')
  await reload
  await check(
    'document.querySelector("[aria-label=推荐依据]")?.value === "保留这段未提交评价"',
    'cancelling native reload preserved the original draft'
  )
  cases.nativeReloadCancel = true
  confirmMode = true
  await button('返回', 'document.querySelector(".v3-feedback-editor")')
  await check('!document.querySelector(".v3-feedback-editor")', 'discard confirmed')
  await check(
    'document.querySelector(".v3-detail-task h3").textContent.includes("尚有面评待提交")',
    'pending refresh completed'
  )
  confirmMode = false
  cases.retainedDraftAcrossTabs = true
  cases.backLogoutCancel = true
  cases.queuedRefresh = true
  await tab('decision')
  await check('!!document.querySelector(".v3-advance-facts")', 'decision ready')
  await snapshot('03-hr-decision-1920')
  await tab('offer')
  await check('document.querySelectorAll(".v4-offer-business .v4-offer-overview > div").length === 3', 'single offer card')
  await snapshot('04-offer-closure-1920')
  rejectedHistory = true
  await tab('history')
  await check(
    'document.querySelector(".v4-application-history [role=alert]")?.textContent.includes("通用事件来源读取失败")',
    'general history partial failure'
  )
  await snapshot('history-source-failure')
  await button('查看晋级历史')
  await check(
    'document.querySelector("[data-detail-history=advancement]").getClientRects().length > 0',
    'other source remains available'
  )
  await tab('history')
  await button('重试通用事件')
  await check(
    'document.querySelectorAll("[data-timeline-event]").length > 0',
    'general history recovered'
  )
  const events = await evaluate(
    '[...document.querySelectorAll("[data-timeline-event]")].map(row => Number(row.dataset.timelineEvent))'
  )
  const auth = await fetch(app.url + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo_admin', password })
  }).then((r) => r.json())
  const server = await fetch(app.url + '/api/v3/applications/' + fixture.id + '/history?limit=20', {
    headers: { Authorization: 'Bearer ' + auth.token }
  }).then((r) => r.json())
  assert.deepEqual(
    [...events].sort((a, b) => a - b),
    server.items.map((e) => e.eventId).sort((a, b) => a - b)
  )
  await click('.v4-event-facts summary')
  await snapshot('05-real-history-1920')
  cases.historyEventIdsMatchedServer = true
  cases.sourceFailureAndRetry = true
  const apiHeaders = { Authorization: 'Bearer ' + auth.token }
  const endpoint = app.url + '/api/v3/applications/' + fixture.id
  let version = await fetch(endpoint, { headers: apiHeaders }).then((r) => r.json()).then((a) => a.version)
  for (let i = 0; i < 21; i++) {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ expectedVersion: version, note: `隔离分页样例 ${i + 1}` })
    })
    const command = await response.json()
    assert.equal(response.status, 200, JSON.stringify(command))
    assert.equal(command.result.version, version + 1)
    version = command.result.version
  }
  await button('刷新详情')
  await check('document.querySelectorAll("[data-timeline-event]").length === 20', 'first history page')
  const firstPage = await fetch(endpoint + '/history?limit=20', { headers: apiHeaders }).then((r) => r.json())
  const nextParams = new URLSearchParams({
    limit: '20',
    afterOccurredAt: String(firstPage.nextCursor.occurredAt),
    afterEventId: String(firstPage.nextCursor.eventId)
  })
  const nextPage = await fetch(endpoint + '/history?' + nextParams, { headers: apiHeaders }).then((r) => r.json())
  // Replay one real boundary event at the HTTP test boundary to exercise deduplication.
  historyOverlap = { ...nextPage, items: [firstPage.items.at(-1), ...nextPage.items] }
  await button('加载更早或后续已记录事件')
  await check('document.querySelectorAll("[data-timeline-event]").length > 20', 'second history page')
  const ids = await evaluate('[...document.querySelectorAll("[data-timeline-event]")].map(row => row.dataset.timelineEvent)')
  const query = historyQueries.at(-1)
  assert.equal(query.afterOccurredAt, String(firstPage.nextCursor.occurredAt))
  assert.equal(query.afterEventId, String(firstPage.nextCursor.eventId))
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(
    ids.map(Number).sort((a, b) => a - b),
    [...firstPage.items, ...nextPage.items].map((event) => event.eventId).sort((a, b) => a - b)
  )
  assert.equal(historyOverlap, null)
  cases.historyCursor = { events: ids.length, firstPage: 20, secondPage: nextPage.items.length, duplicateSuppressed: true, query }
  await snapshot('history-second-page')
  const scroll = { desktop: await verifySticky(1920) }
  for (const [w, h] of [
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [390, 844]
  ]) {
    await view(w, h)
    if (w === 1366) {
      await tab('history')
      scroll.compact = await verifySticky(w)
    }
    await tab('task')
    await check(
      `innerWidth === ${w} && document.documentElement.scrollWidth <= innerWidth + 1`,
      'detail responsive ' + w
    )
    await snapshot('detail-' + w)
    if (w === 390) {
      assert.equal((await scrollState()).profilePosition, 'static')
      await checkCompactActions()
      cases.mobileActionsReachable = true
    }
  }
  await view(1366, 420)
  await button('展开更多资料')
  await until(async () => (await scrollState()).profilePosition === 'static', 'tall profile releases sticky')
  await reachable('#v3-extra-profile dd')
  await button('收起更多资料')
  cases.tallProfileReachable = true
  await view(1920, 1080)
  await button('← 返回候选人管理')
  await check(
    `location.search === ${JSON.stringify(locationBefore)} && document.activeElement.getAttribute('data-application-link') === '${fixture.id}'`,
    'list filter and focus returned'
  )
  cases.returnedToFocusedStageList = true
  await click(boardLink)
  await h1('申请详情')
  cases.nativeZoom = await waitForNativeZoom()
  cases.nativeZoom.actionsReachable = true
  await view(1920, 1080)

  const listBase = '/candidates?positionId=' + row.position_id + '&applicationStatus=active'
  const restored = []
  for (const [mode, query, layout] of [
    ['board', '', '.v4-board:not(.v4-board-focus)'],
    ['table', '&view=table', 'tbody'],
    ['focus', '&stage=' + row.stage, '.v4-focus-cards']
  ]) {
    await go(listBase + query)
    const opener = layout + ' ' + boardLink
    await check(`!!document.querySelector(${JSON.stringify(opener)})`, mode + ' detail opener')
    const listSearch = await evaluate('location.search')
    await click(opener)
    await h1('申请详情')
    await button('← 返回候选人管理')
    await check(
      `location.search === ${JSON.stringify(listSearch)} && document.activeElement.dataset.applicationLink === '${fixture.id}'`,
      mode + ' returned filter and focus'
    )
    restored.push(mode)
  }
  cases.listReturn = restored

  const nextStage = 'second_interview'
  const count = (stage) => `parseInt(document.querySelector('[data-stage=${stage}] .v4-stage-count')?.textContent, 10)`
  await go(listBase)
  await check(`Number.isInteger(${count(row.stage)}) && Number.isInteger(${count(nextStage)})`, 'both active column totals ready')
  const previousStageCount = await evaluate(count(row.stage))
  const nextStageCount = await evaluate(count(nextStage))
  await click(boardLink)
  await h1('申请详情')
  await tab('decision')
  await button('核验并决定晋级')
  await check('!!document.querySelector(".v3-advance-editor")', 'advancement editor')
  await field('晋级理由', '隔离浏览器验收：保留真实缺评并确认推进')
  confirmMode = true
  await button('确认晋级', 'document.querySelector(".v3-advance-editor")')
  await check('!!document.querySelector(".v4-detail-notice") && document.querySelector(".v4-detail-notice").textContent.includes("服务器状态已更新")', 'advance refreshed from server')
  confirmMode = false
  const advanced = await fetch(endpoint, { headers: apiHeaders }).then((r) => r.json())
  assert.equal(advanced.stage, nextStage)
  await button('← 返回候选人管理')
  await check(
    `!!document.querySelector('${`[data-stage=${nextStage}] ${boardLink}`}') && ${count(row.stage)} === ${previousStageCount - 1} && ${count(nextStage)} === ${nextStageCount + 1}`,
    'real advancement refreshed both column totals and moved card'
  )
  cases.advancedListRefresh = { from: row.stage, to: nextStage, fromCounts: [previousStageCount, previousStageCount - 1], toCounts: [nextStageCount, nextStageCount + 1] }
  await snapshot('active-columns-after-advancement')

  await go(listBase + '&stage=' + nextStage)
  await check(`!!document.querySelector(${JSON.stringify(boardLink)})`, 'focused advanced application')
  const stageCount = '[data-stage=' + nextStage + '] .v4-stage-count'
  const activeCount = Number.parseInt(await evaluate(`document.querySelector('${stageCount}').textContent`), 10)
  assert.ok(activeCount > 0)
  await click(boardLink)
  await h1('申请详情')
  await tab('offer')
  await button('结束招聘', 'document.querySelector(".v4-offer-closure")')
  await check('!!document.querySelector(\'[aria-label="结束类型"]\')', 'closure editor ready')
  await evaluate(`(() => {
    const select = document.querySelector('[aria-label="结束类型"]');
    select.value = 'candidate_withdrew';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await field('结束原因', '隔离浏览器验收：候选人退出')
  confirmMode = true
  await button('确认执行', 'document.querySelector(".v3-offer-editor")')
  await check('document.querySelector(".v4-detail-heading [data-state=closed]")', 'server-confirmed closed detail')
  const closed = await fetch(endpoint, { headers: apiHeaders }).then((r) => r.json())
  assert.equal(closed.applicationStatus, 'closed')
  assert.equal(closed.outcome, 'candidate_withdrew')
  await snapshot('server-confirmed-closure')
  confirmMode = false
  await button('← 返回候选人管理')
  await check(
    `!document.querySelector(${JSON.stringify(boardLink)}) && parseInt(document.querySelector('${stageCount}')?.textContent, 10) === ${activeCount - 1}`,
    'active focus reread after recorded closure'
  )
  await snapshot('active-count-after-closure')
  await go(listBase.replace('applicationStatus=active', 'applicationStatus=closed') + '&stage=' + nextStage)
  await check(`!!document.querySelector(${JSON.stringify(boardLink)})`, 'known closed application remains in its real stage')
  cases.closedListRefresh = { activeBefore: activeCount, activeAfter: activeCount - 1, closedRecordFound: true, stage: closed.stage }

  await go('/positions/' + row.position_id)
  await check('!!document.querySelector(".v4-position-detail .position-preview-heading")', 'position detail source')
  const previewLink = '.v4-position-detail td a[href*="/candidates/' + fixture.id + '?"]'
  if (!(await evaluate('!!document.querySelector(' + JSON.stringify(previewLink) + ')'))) {
    await check('!!document.querySelector(".v4-position-detail td a")', 'position has linked applications')
  }
  await click((await evaluate('!!document.querySelector(' + JSON.stringify(previewLink) + ')')) ? previewLink : '.v4-position-detail td a')
  await h1('申请详情')
  await check('document.querySelector(".v4-detail-heading > button")?.textContent.includes("返回职位详情")', 'application has position return')
  await click('.v4-detail-heading > button')
  await check('location.pathname === "/positions/' + row.position_id + '" && !!document.querySelector(".position-facts")', 'application returns to position')
  await go('/candidates/999999')
  await check('document.body.innerText.includes("未找到申请")', '404')
  readStatus = 403
  await go(path)
  await check('document.body.innerText.includes("没有权限查看申请")', '403')
  await button('重新加载')
  await check('!!document.querySelector(".v4-detail-identity")', '403 retry recovers')
  readStatus = 401
  await go(path)
  await h1('欢迎回来')
  cases.authorization = { missing: true, forbidden: true, expiry: true }
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chrome: (await send('Browser.getVersion')).product,
        applicationId: fixture.id,
        cases,
        events,
        generalReads,
        historyQueries,
        unifiedScroll: scroll,
        designGeometry,
        confirms: confirmTexts,
        dialogTypes
      },
      null,
      2
    )
  )
} finally {
  ws?.close()
  chrome.kill()
  await running.close()
}
