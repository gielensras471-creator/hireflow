import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const output = process.argv[2] ?? (await mkdtemp(join(tmpdir(), 'hireflow-ui02-evidence-')))
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'hireflow-ui01-chrome-'))
const root = (p) => pathToFileURL(join(process.cwd(), p))

const { initializeV3File, initializeFirstHr } = await import(root('server/db/persistent-v3.js'))
const { startV3Server } = await import(root('server/index-v3.js'))
const { randomBytes } = await import('node:crypto')
const { createServer } = await import('node:net')
const dataRoot = await mkdtemp(join(tmpdir(), 'hf-dev03-browser-'))
const file = join(dataRoot, 'fictional.db')
await initializeV3File(dataRoot, file, 'Codex DEV-03 fictional browser')
const username = 'fictional-prod-hr',
  password = randomBytes(18).toString('base64url')
initializeFirstHr(dataRoot, file, { username, password, name: '虚构生产等价HR' })
const serverPort = await new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(() => resolve(p))
  })
})
const env = {
  NODE_ENV: 'production',
  V3_DATA_ROOT: dataRoot,
  V3_DATABASE_PATH: file,
  V3_JWT_SECRET: randomBytes(48).toString('hex'),
  V3_PORT: String(serverPort),
  V3_STATIC_DIR: process.argv[3] ?? join(process.cwd(), 'dist-v3')
}
const running = await startV3Server(env)
const db = running.db
const app = {
  username,
  password,
  url: 'http://127.0.0.1:' + serverPort,
  async close() {
    await running.close()
  }
}
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
const pending = new Map()
let seq = 0
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

const addPosition = db.prepare(
  'INSERT INTO positions(title,department,location,status,publish_date,description,deleted_at) VALUES (?,?,?,?,?,?,?)'
)
for (let id = 1; id <= 121; id++) {
  addPosition.run(
    '虚构职位 · ' + id,
    id % 2 ? '产品设计部' : '招聘运营部',
    '上海',
    id % 3 === 0 ? 'closed' : 'open',
    id > 100 ? '2026-12-01' : '2026-11-01',
    '隔离验收数据',
    id === 3 ? Date.now() : null
  )
}
const fixtureStages = ['screening', 'first_interview', 'second_interview', 'offer']
const addApplication = db.prepare(`INSERT INTO candidates
  (position_id,name,education,school,phone,email,owner,applied_date,created_at,stage,application_status,outcome,offer_status,closed_reason,closed_at)
  VALUES (?,?,'','','','','虚构负责人','2026-11-10',1,?,?,?,?,?,?)`)
for (let index = 0; index < 48; index++) {
  const stage = fixtureStages[index % 4]
  addApplication.run(
    index % 2 ? 6 : 3,
    '虚构申请 · ' + (index + 1),
    stage,
    'active',
    null,
    stage === 'offer' ? 'sent' : null,
    null,
    null
  )
}
addApplication.run(
  3,
  '虚构已结束申请',
  'second_interview',
  'closed',
  'company_rejected',
  null,
  '隔离结案',
  2
)
db.prepare(
  `INSERT INTO interviews(candidate_id,stage_scope,scheduled_at,interviewer_name,status,created_at,completed_at)
  VALUES (2,'first_interview',2,'虚构面试官','completed',1,3)`
).run()

const reads = []
const viewportResults = []
let failPositionsNext = 0
const heldSearch = []
let throttledNext
let dropWriteResponse = false
const writes = []
const view = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
const key = async (name, code) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: code
    })
}
const setSearch = (value) =>
  evaluate(`(() => {
  const field = document.querySelector('[aria-label="搜索"]')
  field.value = ${JSON.stringify(value)}
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.form.requestSubmit()
})()`)
const useButton = async (text, scope = 'document') => {
  const button = `[...${scope}.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)})`
  await check(`Boolean(${button})`, text)
  return evaluate(`(${button}).click()`)
}
const cards = '.v4-position-card'
const screening = '[data-stage="screening"]'
const column = (stage) => `[data-stage="${stage}"]`
const appCards = '.v4-application-card'

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
    const message = JSON.parse(data)
    if (message.id) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message))
      else call?.resolve(message.result)
      return
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      void send('Page.handleJavaScriptDialog', { accept: true })
      return
    }
    if (message.method !== 'Fetch.requestPaused') return
    const { requestId, request } = message.params
    const url = new URL(request.url)
    if (request.method === 'PATCH') {
      if (message.params.responseStatusCode !== undefined) {
        dropWriteResponse = false
        void send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
        return
      }
      const idempotencyKey = Object.entries(request.headers).find(
        ([name]) => name.toLowerCase() === 'idempotency-key'
      )?.[1]
      writes.push({ idempotencyKey, expectedVersion: JSON.parse(request.postData).expectedVersion })
      void send('Fetch.continueRequest', { requestId, interceptResponse: dropWriteResponse })
      return
    }
    const query = Object.fromEntries(url.searchParams)
    reads.push({ path: url.pathname, query })
    if (query.q === '慢请求') {
      heldSearch.push(requestId)
      return
    }
    if (query.stage === 'screening' && query.offset === '10' && throttledNext === true) {
      throttledNext = requestId
      return
    }
    if (url.pathname.endsWith('/positions') && query.limit === '100' && failPositionsNext) {
      const responseCode = failPositionsNext
      failPositionsNext = 0
      void send('Fetch.fulfillRequest', {
        requestId,
        responseCode,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from('{"error":{"code":"FIXTURE","message":"test outage"}}').toString('base64')
      })
    } else void send('Fetch.continueRequest', { requestId })
  }
  await Promise.all([
    send('Page.enable'),
    send('Network.enable'),
    send('Runtime.enable'),
    view(1920, 1080)
  ])
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*/api/v3/positions?*' },
      { urlPattern: '*/api/v3/applications?*' },
      { urlPattern: '*/api/v3/positions/*' }
    ]
  })
  await go('/positions')
  await h1('欢迎回来')
  await fill(app.password, true)
  await h1('职位管理')
  await check(
    `document.querySelectorAll('${cards}').length === 9 && document.querySelector('${cards} .v4-position-identity small').textContent === '职位 #101'`,
    'cross-source-page publication order and nine cards'
  )
  assert.deepEqual(
    reads
      .filter(({ path, query }) => path.endsWith('positions') && query.limit === '100')
      .map(({ query }) => query.offset),
    ['0', '100', '0', '100']
  )
  await check(
    'document.querySelector(".v4-position-metrics").textContent.includes("开放职位 81") && document.querySelector(".v4-position-metrics").textContent.includes("已关闭职位 40")',
    'actual metrics'
  )
  await snapshot('positions-cards-1920')
  await click('.v4-position-card footer a')
  await check(
    'location.pathname === "/positions/101" && document.querySelector(".position-metrics dd")',
    'card opens position detail'
  )
  const positionTitle = await evaluate('document.querySelector(".position-title h1").textContent')
  await check(
    'document.querySelector("[aria-current=page]")?.textContent.includes(' +
      JSON.stringify(positionTitle) +
      ')',
    'position title on active tab'
  )
  await check(
    `document.querySelector('.v3-sidebar a[href="/positions"]')?.classList.contains('is-current')`,
    'position nav active'
  )
  await snapshot('position-detail-1920')
  await click('.v4-position-detail > a')
  await h1('职位管理')
  await check(
    'document.activeElement.dataset.positionLink==="101"',
    'position list restores original focus'
  )

  await click('.v4-position-card .v4-more-button')
  await check(
    'document.querySelector(".v4-position-menu button") === document.activeElement',
    'menu opens with focus'
  )
  await snapshot('positions-menu')
  await key('Escape', 27)
  await check(
    'document.activeElement.matches(".v4-more-button") && !document.querySelector(".v4-position-menu")?.offsetWidth',
    'Escape returns to menu trigger'
  )
  await click('.v4-position-card .v4-more-button')
  await useButton('归档', 'document.querySelector(".v4-position-menu")')
  await check(
    'document.querySelector(".v3-editor")?.textContent.includes("归档后不能接收新申请")',
    'archive uses V3 editor'
  )
  await snapshot('positions-archive-confirmation')
  await useButton('取消', 'document.querySelector(".v3-editor")')
  await check(
    '!document.querySelector(".v3-editor") && document.activeElement.matches(".v4-more-button")',
    'cancel archive restores menu focus'
  )
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM positions WHERE deleted_at IS NOT NULL').get().n,
    1
  )
  await useButton('☷ 表格')
  await check(
    'document.querySelectorAll("tbody tr").length === 10 && location.search.includes("view=table")',
    'ten table rows'
  )
  await snapshot('positions-table-1920')
  await click('.v4-positions-table tbody [data-position-link]')
  await check(
    'location.pathname === "/positions/101" && document.querySelector(".position-facts")',
    'table shares position detail'
  )
  await click('.v4-position-detail > a')
  await check(
    'location.search.includes("view=table") && document.activeElement.dataset.positionLink==="101"',
    'table view and anchor restored'
  )

  await setSearch('虚构职位 · 120')
  await check('document.querySelectorAll("tbody tr").length === 1', 'filtered table')
  await useButton('▦ 卡片')
  await check(
    `document.querySelectorAll('${cards}').length === 1 && document.querySelector('[aria-label=搜索]').value.includes('120')`,
    'filter is shared'
  )
  await check(
    'document.querySelector(".v4-position-interviews")?.textContent.includes("0 场")',
    'real zero completed interviews'
  )
  await go('/positions?view=table&offset=900')
  await check(
    'new URLSearchParams(location.search).get("offset") === "120" && document.querySelectorAll("tbody tr").length === 1',
    'illegal page offset recovers'
  )
  failPositionsNext = 503
  await go('/positions')
  await check('document.body.innerText.includes("暂时无法查看记录")', 'global position failure')
  await snapshot('positions-error')
  await useButton('重新加载')
  await check(`document.querySelectorAll('${cards}').length === 9`, 'global retry recovered')
  await go('/positions?q=' + encodeURIComponent('虚构职位 · 3'))
  await check(
    'document.querySelector(".v4-position-card")?.textContent.includes("已归档")',
    'retained archived position'
  )
  assert.equal(
    await evaluate('document.querySelector(".v4-position-card").querySelector(".v4-more-button")'),
    null
  )
  await click('.v4-position-card footer a')
  await check(
    `!!document.querySelector('.v4-position-detail a[href*="positionId=3"]')`,
    'archived position links to history'
  )
  assert.equal(await evaluate('location.pathname'), '/positions/3')
  assert.equal(
    await evaluate('document.querySelector(".v4-position-detail .position-primary")'),
    null
  )
  await send('Page.reload')
  await check(
    'document.querySelector(".position-facts")?.innerText.includes("#3")',
    'position deep link reload'
  )
  await click('.position-accent')
  await h1('候选人管理')
  await check(
    'new URLSearchParams(location.search).get("positionId") === "3" && new URLSearchParams(location.search).get("applicationStatus") === "all" && document.querySelector(".v4-stage-count")?.textContent !== "—"',
    'position deep link'
  )
  await go('/candidates')
  await check(
    `document.querySelectorAll('.v4-stage').length === 4 && document.querySelectorAll('${appCards}').length >= 40`,
    'independent first requests'
  )
  for (const stage of fixtureStages)
    assert.ok(
      reads.some(
        ({ path, query }) =>
          path.endsWith('/applications') &&
          query.stage === stage &&
          query.applicationStatus === 'active' &&
          query.offset === '0'
      )
    )
  await check(
    'getComputedStyle(document.querySelector(".v4-list-tools")).flexWrap === "nowrap"',
    'desktop toolbar is single line'
  )
  await snapshot('candidates-board-1920')
  const screeningScroll = `document.querySelector('${screening} .v4-stage-scroll')`
  const scrollToEnd = () =>
    evaluate(
      `(() => { const el = ${screeningScroll}; el.scrollTop = el.scrollHeight; for (let i = 0; i < 4; i++) el.dispatchEvent(new Event('scroll')); })()`
    )
  throttledNext = true
  await scrollToEnd()
  const paused = await until(
    () => typeof throttledNext === 'string' && throttledNext,
    'hold triggered page'
  )
  await check(
    `document.querySelector('${screening} .v4-stage-status').dataset.state === 'loading'`,
    'column bottom loading'
  )
  await snapshot('candidates-column-loading')
  await scrollToEnd()
  assert.equal(
    reads.filter(({ query }) => query.stage === 'screening' && query.offset === '10').length,
    1
  )
  await send('Fetch.failRequest', { requestId: paused, errorReason: 'InternetDisconnected' })
  await check(
    `document.querySelector('${screening} .v4-stage-status').dataset.state === 'error'`,
    'local failure'
  )
  await snapshot('candidates-column-error')
  assert.equal(
    await evaluate(`document.querySelectorAll('${column('first_interview')} ${appCards}').length`),
    10
  )
  await useButton('重试', `document.querySelector('${screening} .v4-stage-status')`)
  await check(`${screeningScroll}.dataset.loaded === '12'`, 'retry reuses failed offset')
  assert.deepEqual(
    reads
      .filter(({ query }) => query.stage === 'screening' && query.offset === '10')
      .map(({ query }) => query.offset),
    ['10', '10']
  )
  assert.equal(
    await evaluate(
      `new Set([...document.querySelectorAll('${screening} [data-application-link]')].map(x => x.dataset.applicationLink)).size`
    ),
    12
  )
  const openId = await evaluate(
    `[...document.querySelectorAll('${screening} [data-application-link]')].pop().dataset.applicationLink`
  )
  await click(`[data-application-link="${openId}"]`)
  await h1('申请详情')
  await useButton('← 返回候选人管理')
  await h1('候选人管理')
  await check(
    `document.activeElement.dataset.applicationLink === '${openId}' && ${screeningScroll}.scrollTop > 0`,
    'detail return restores loaded pages and focus'
  )
  await setSearch('慢请求')
  await until(() => heldSearch.length === 4, 'four late requests held')
  await setSearch('虚构申请 · 12')
  await check(
    `document.querySelector('.v4-application-card')?.textContent.includes('虚构申请 · 12')`,
    'new search result'
  )
  await Promise.all(heldSearch.map((requestId) => send('Fetch.continueRequest', { requestId })))
  await sleep(300)
  assert.ok(
    await evaluate(
      `document.querySelector('.v4-application-card')?.textContent.includes('虚构申请 · 12')`
    )
  )
  await click('.v4-clear-button')
  await check(`document.querySelectorAll('${appCards}').length >= 40`, 'clear returned to defaults')
  await useButton('☷ 表格')
  await check('document.querySelectorAll("tbody tr").length === 20', 'candidate table page size')
  await snapshot('candidates-table-1920')
  await useButton('下一页')
  await check(
    'new URLSearchParams(location.search).get("offset") === "20"',
    'candidate table paginates'
  )
  await view(390, 844)
  await check('document.querySelectorAll("tbody tr").length === 20', 'second page rendered')
  const tableScroll = 'document.querySelector(".v4-recruiting-table .v3-table-scroll")'
  await evaluate(`(() => { const el = ${tableScroll}; el.scrollTo(el.scrollWidth, 150) })()`)
  const tableId = await evaluate(
    'document.querySelectorAll("tbody [data-application-link]")[4].dataset.applicationLink'
  )
  await click(`[data-application-link="${tableId}"]`)
  await h1('申请详情')
  await useButton('← 返回候选人管理')
  await check(
    `document.activeElement.dataset.applicationLink === '${tableId}' && ${tableScroll}.scrollLeft > 0 && ${tableScroll}.scrollTop > 0 && new URLSearchParams(location.search).get("offset") === "20"`,
    'table return restores both scroll axes and focus'
  )
  await view(1920, 1080)
  await go('/candidates?stage=first_interview')
  await check(
    'document.querySelectorAll(".v4-stage").length === 1 && document.querySelectorAll(".v4-focus-cards .v4-application-card").length >= 10',
    'single-stage focus'
  )
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".v4-focus-cards")).gridTemplateColumns.split(" ").length'
    ),
    4
  )
  assert.ok(
    await evaluate(
      'document.querySelector(".v4-focus-cards .v4-application-card").offsetWidth <= 416'
    )
  )
  await snapshot('candidates-focus-1920')
  await go('/candidates?positionId=3&stage=second_interview&applicationStatus=closed')
  await check(
    'document.querySelector(".v4-application-card")?.textContent.includes("企业淘汰")',
    'archived position closed application stays in final stage'
  )
  for (const [w, h] of [
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [390, 844]
  ]) {
    await view(w, h)
    await go('/candidates')
    await check(
      `innerWidth === ${w} && document.querySelectorAll('.v4-stage').length === 4 && document.querySelectorAll('${appCards}').length >= 40`,
      'board viewport ' + w
    )
    const actual = await evaluate(
      '({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })'
    )
    assert.ok(actual.scrollWidth <= actual.width + 1)
    await snapshot('candidates-board-' + w)
    viewportResults.push(actual)
    await go('/positions')
    await check(
      `innerWidth === ${w} && document.querySelectorAll('${cards}').length === 9 && document.documentElement.scrollWidth <= innerWidth + 1`,
      'positions viewport ' + w
    )
    await snapshot('positions-cards-' + w)
  }

  await go('/positions/999999')
  await check('document.body.innerText.includes("职位不存在")', 'missing position')
  await snapshot('position-detail-404')
  await go('/candidates')
  await h1('候选人管理')
  await send('Emulation.clearDeviceMetricsOverride')
  const { windowId } = await send('Browser.getWindowForTarget')
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 900 } })
  await check('innerWidth > 1300', 'settled Chrome window')
  const unzoomed = await evaluate('({ width: innerWidth, dpr: devicePixelRatio })')
  const {
    targetInfo: { targetId: originalTab }
  } = await send('Target.getTargetInfo')
  const { targetId: settingsTab } = await send('Target.createTarget', {
    url: 'chrome://settings/appearance',
    background: true
  })
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: settingsTab,
    flatten: true
  })
  try {
    await until(async () => {
      const result = await send(
        'Runtime.evaluate',
        {
          expression: 'typeof chrome.settingsPrivate?.setDefaultZoom === "function"',
          returnByValue: true
        },
        sessionId
      )
      return result.result?.value === true
    }, 'Chrome zoom settings')
    await send(
      'Runtime.evaluate',
      { expression: 'chrome.settingsPrivate.setDefaultZoom(2)' },
      sessionId
    )
    await send('Target.activateTarget', { targetId: originalTab })
    await send('Page.reload')
    await h1('候选人管理')
    await check(
      'devicePixelRatio >= 1.95 && document.querySelectorAll(".v4-stage").length === 4',
      'native zoom layout'
    )
    const native = await evaluate(
      '({ width: innerWidth, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth })'
    )
    assert.ok(
      native.width <= Math.ceil(unzoomed.width * 0.51) && native.scrollWidth <= native.width + 1
    )
    viewportResults.push({ nativeZoom: 2, unzoomed, ...native })
    for (const [path, title, selector, name] of [
      ['/candidates', '候选人管理', '.v4-application-card', 'candidates-native-200'],
      ['/positions', '职位管理', '.v4-position-card', 'positions-native-200'],
      ['/positions/101', null, '.position-facts', 'position-detail-native-200']
    ]) {
      if (path !== '/candidates') await go(path)
      if (title) await h1(title)
      await check(
        `!!document.querySelector('${selector}') && document.documentElement.scrollWidth <= innerWidth + 1`,
        'zoomed data ' + title
      )
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const { data } = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false
      })
      assert.ok(Buffer.from(data, 'base64').length > 8000)
      await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
    }
  } finally {
    await send(
      'Runtime.evaluate',
      { expression: 'chrome.settingsPrivate?.setDefaultZoom(1)' },
      sessionId
    )
    await send('Target.closeTarget', { targetId: settingsTab })
  }

  await view(1440, 900)
  await go('/positions?q=' + encodeURIComponent('虚构职位 · 101'))
  const editPosition = async () => {
    await check(
      '!!document.querySelector(".v4-position-card .v4-more-button")',
      'position ready to edit'
    )
    await click('.v4-position-card .v4-more-button')
    await useButton('编辑', 'document.querySelector(".v4-position-menu")')
    await check(
      '!!document.querySelector(".v3-editor [aria-label=职位名称]")',
      'position editor loaded'
    )
  }
  const changeTitle = (text) =>
    evaluate(`(() => {
    const input = document.querySelector('.v3-editor [aria-label="职位名称"]')
    input.value = ${JSON.stringify(text)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const savePosition = () => evaluate('document.querySelector(".v3-editor form").requestSubmit()')
  const stored = () => db.prepare('SELECT version,title FROM positions WHERE id=101').get()
  await editPosition()
  db.prepare('UPDATE positions SET version=2 WHERE id=101').run()
  await changeTitle('虚构职位 · 101 · 冲突后确认')
  await savePosition()
  await check(
    '!!document.querySelector(".v3-conflict-summary") && document.querySelector("[aria-label=职位名称]").value.includes("冲突后确认")',
    '409 preserves draft'
  )
  await snapshot('positions-version-conflict')
  await useButton('确认按新版本提交草稿')
  await check('!document.querySelector(".v3-editor")', 'confirmed write succeeds')
  assert.equal(stored().version, 3)
  assert.deepEqual(
    writes.slice(0, 2).map(({ expectedVersion }) => expectedVersion),
    [1, 2]
  )
  assert.notEqual(writes[0].idempotencyKey, writes[1].idempotencyKey)
  await editPosition()
  await changeTitle('虚构职位 · 101 · 原键重试')
  dropWriteResponse = true
  await evaluate(
    '(() => { const form = document.querySelector(".v3-editor form"); form.requestSubmit(); form.requestSubmit() })()'
  )
  await check(
    'document.querySelector(".v3-editor").textContent.includes("本次操作结果尚未确认")',
    'lost write response retains original intent'
  )
  await snapshot('positions-write-uncertain')
  assert.equal(writes.length, 3)
  assert.equal(stored().version, 4)
  await useButton('重试原请求')
  await check('!document.querySelector(".v3-editor")', 'same-key retry succeeds')
  assert.equal(writes.length, 4)
  assert.ok(writes[2].idempotencyKey)
  assert.deepEqual(writes[2], writes[3])
  assert.equal(stored().version, 4)
  failPositionsNext = 403
  await go('/positions')
  await check(
    'document.body.innerText.includes("当前操作未获允许，登录状态仍有效")',
    '403 preserves valid account'
  )
  await useButton('重新加载')
  await check(
    'document.querySelectorAll(".v4-position-card").length === 9',
    '403 recovers when query permitted'
  )
  failPositionsNext = 401
  await go('/positions')
  await h1('欢迎回来')

  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chrome: (await send('Browser.getVersion')).product,
        fixture: { positions: 121, applications: 49, archivedPositions: 1 },
        verified: [
          'live position totals',
          'cross-page stable order',
          '9/10/20 page sizes',
          'archive cancel and focus',
          'global retry',
          'illegal page offset',
          'archive deep link',
          'four stage queries',
          'local duplicate-blocked paging',
          'retry same offset',
          'late search response',
          'detail return and focus',
          'four-column focus with 416px card cap',
          'closed final stage'
        ],
        viewportResults,
        writes: {
          versionConflictPreservedDraft: true,
          duplicateSubmitBlocked: true,
          lostResponseReusedKey: true,
          finalVersion: stored().version
        },
        authorization: { forbiddenKeptIdentity: true, unauthorizedReturnedToLogin: true },
        reads
      },
      null,
      2
    )
  )
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
}
