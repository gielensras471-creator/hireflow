import { tableChecks, selectedChecks, observerProbe } from './refine-list-checks.mjs'
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
const { createV3App } = await import(root('server/app-v3.js'))
const { openDatabase } = await import(root('server/db/database.js'))
const { createV3Schema } = await import(root('server/db/schema-v3.js'))
const { default: bcrypt } = await import(root('node_modules/bcryptjs/index.js'))
const { createServer } = await import(root('node_modules/vite/dist/node/index.js'))
const { randomBytes } = await import('node:crypto')
const originalNow = Date.now
let fixtureNow = Date.parse('2030-01-01T13:59:59+08:00')
Date.now = () => fixtureNow
const db = openDatabase(':memory:')
createV3Schema(db)
const username = 'local-hr'
const password = randomBytes(18).toString('base64url')
db.prepare(
  'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
).run(username, bcrypt.hashSync(password, 10), '本地演示 HR', 'hr', '', '', '')
let holdPath = null,
  releaseHeld = null,
  failSummary = false,
  failWork = false,
  failToday = false,
  denySummary = false
const dialogs = [],
  browserWrites = []
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
wrapped.use(express.json())
wrapped.use((req, res, next) => {
  if (req.path === holdPath) {
    holdPath = null
    releaseHeld = () => next()
    return
  }
  if (req.path === '/api/v3/dashboard/summary' && denySummary) {
    denySummary = false
    return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
  }
  if (
    (failSummary && req.path.endsWith('/summary')) ||
    (failWork && req.path.includes('/work-items/')) ||
    (failToday && req.path.endsWith('/today-interviews'))
  )
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  next()
})
wrapped.use(createV3App({ db, authConfig: { jwtSecret: randomBytes(48).toString('hex') } }))
const api = await new Promise((resolve) => {
  const server = wrapped.listen(0, '127.0.0.1', () => resolve(server))
})
const vite = await createServer({
  cacheDir: join(profile, 'vite-cache'),
  mode: 'v3-local',
  server: {
    host: '127.0.0.1',
    proxy: {
      '^/api/v3(?:/|$)': { target: 'http://127.0.0.1:' + api.address().port, changeOrigin: true }
    }
  }
})
await new Promise((resolve) => vite.httpServer.listen(0, '127.0.0.1', resolve))
const app = {
  username,
  password,
  url: 'http://127.0.0.1:' + vite.httpServer.address().port,
  async close() {
    await vite.close()
    await new Promise((resolve) => api.close(resolve))
    db.close()
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
const requests = []
const meStatuses = []
const pending = new Map()
let seq = 0
let dialogMode = null
function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
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
  if (process.env.R04_C === '1') {
    if (
      ![
        'dashboard-empty',
        'dashboard-loading',
        'dashboard-error',
        'r04c-work-loading',
        'r04c-today-loading',
        'r04c-work-error',
        'r04c-today-error',
        'r04c-retry-focus'
      ].includes(name)
    )
      return
    const target = name.includes('today')
      ? '.v3-dashboard-today'
      : name.includes('work')
        ? '.v3-dashboard-details'
        : ['dashboard-error', 'r04c-retry-focus'].includes(name)
          ? '.v3-feedback[data-state=error]'
          : null
    if (target)
      await evaluate(
        'document.querySelector(' +
          JSON.stringify(target) +
          ')?.scrollIntoView({block:"start",behavior:"instant"})'
      )
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
    await evaluate('window.scrollTo({top:0,behavior:"instant"})')
    return
  }

  if (process.env.R04_AB === '1') {
    if (!name.startsWith('r04-') && !['dashboard-error', 'dashboard-empty'].includes(name)) return
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    await writeFile(join(output, name + '.png'), Buffer.from(data, 'base64'))
    return
  }

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

async function r04Checks() {
  const rows = []
  for (const [w, h] of [
    [1440, 900],
    [1100, 900],
    [390, 844],
    [390, 900],
    [320, 844]
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false
    })
    await check('window.innerWidth===' + w, 'R04 viewport')
    if (w < 800)
      await check(
        'document.querySelector(".v3-shell").dataset.tier==="mobile"',
        'mobile Shell settles'
      )
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    await evaluate('window.scrollTo(0,0)')
    const m = await evaluate(
      '(()=>{const g=document.querySelector(".v3-dashboard-metrics"),r=g.getBoundingClientRect(),cards=[...g.children].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})),work=document.querySelector(".v3-dashboard-work").closest("section");return {width:innerWidth,height:innerHeight,columns:getComputedStyle(g).gridTemplateColumns.split(" ").length,gridHeight:r.height,cards,workTop:work.getBoundingClientRect().top,scrollWidth:document.documentElement.scrollWidth}})()'
    )
    if (m.columns !== (w >= 1100 ? 4 : w === 390 ? 2 : 1))
      console.log(
        'R04 layout',
        m,
        await evaluate('getComputedStyle(document.documentElement).fontSize')
      )
    assert.equal(m.columns, w >= 1100 ? 4 : w === 390 ? 2 : 1)
    assert.ok(m.scrollWidth <= w)
    rows.push(m)
    if (w !== 320) await snapshot('r04-' + w + 'x' + h)
  }
  await width(390)
  await evaluate('document.documentElement.style.zoom="2"')
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".v3-dashboard-metrics")).gridTemplateColumns.split(" ").length'
    ),
    1
  )
  const zoomBounds = await evaluate(
    '({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,bodyMinWidth:getComputedStyle(document.body).minWidth,columns:getComputedStyle(document.querySelector(".v3-dashboard-metrics")).gridTemplateColumns.split(" ").length})'
  )
  rows.push({
    pressure: 'Chromium CSS zoom 200%; not toolbar zoom',
    ...zoomBounds,
    knownBoundary: 'global reset.scss body minimum 320px; outside Dashboard-only scope'
  })
  await evaluate('document.documentElement.style.zoom=""')
  await evaluate(
    'window.__r04text=[...document.querySelectorAll(".v3-dashboard-metrics h2,.v3-dashboard-metrics strong")].map(e=>[e,e.textContent]);window.__r04text.forEach(([e])=>e.textContent=e.tagName==="STRONG"?"999999999999999":"真实标题布局压力测试".repeat(5))'
  )
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'))
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-dashboard-metrics strong")].every(e=>e.scrollWidth<=e.clientWidth+1)'
    )
  )
  await evaluate('window.__r04text.forEach(([e,t])=>e.textContent=t);delete window.__r04text')
  rows.push({ pressure: 'synthetic DOM text only; restored original real values', overflow: false })
  await width(1440)
  await writeFile(
    join(output, 'r04-measurements.json'),
    JSON.stringify({ measurements: rows, statisticsUnchanged: true }, null, 2)
  )
}

const evidence = []
try {
  const port = await until(
    async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
    'Chrome debugging port'
  )
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  ws = new WebSocket(pages.find((x) => x.type === 'page').webSocketDebuggerUrl)
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
    if (m.method === 'Network.requestWillBeSent') {
      requests.push(m.params.request.url)
      const { url, method } = m.params.request
      const path = new URL(url).pathname
      if (
        path.startsWith('/api/v3/') &&
        !path.startsWith('/api/v3/auth/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(method)
      )
        browserWrites.push({ path, method })
    }
    if (
      m.method === 'Network.responseReceived' &&
      m.params.response.url.endsWith('/api/v3/auth/me')
    )
      meStatuses.push(m.params.response.status)
    if (m.method === 'Page.javascriptDialogOpening') dialogs.push(m.params.message)
    if (m.method === 'Page.javascriptDialogOpening' && dialogMode !== null)
      void send('Page.handleJavaScriptDialog', { accept: dialogMode })
  }
  await Promise.all([send('Page.enable'), send('Network.enable'), width(1440)])

  const login = await fetch(app.url + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember: true })
  })
  const token = (await login.json()).token
  let command = 0
  const apiGet = async (path) => {
    const r = await fetch(app.url + '/api/v3' + path, {
      headers: { Authorization: 'Bearer ' + token }
    })
    assert.equal(r.status, 200)
    return r.json()
  }
  const apiPost = async (path, body, method = 'POST') => {
    const r = await fetch(app.url + '/api/v3' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'fixture-' + ++command
      },
      body: JSON.stringify(body)
    })
    return { status: r.status, data: await r.json() }
  }

  const button = async (text, scope = 'document') => {
    const e =
      '([...(' +
      scope +
      '?.querySelectorAll("button")??[])].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      '&&!e.disabled))'
    await check(e + '!==undefined', 'button ' + text)
    await evaluate(e + '.click()')
  }
  const refresh = async () => {
    await button('刷新工作台')
    await check(
      '!!document.querySelector("[data-metric]")&&!document.querySelector(".v3-dashboard-details [role=status]")',
      'refresh settled'
    )
  }
  const selection = async (type) => {
    await evaluate(
      '(()=>{const e=document.querySelector("[aria-label=待办类别]");e.value=' +
        JSON.stringify(type) +
        ';e.dispatchEvent(new Event("change",{bubbles:true}))})()'
    )
    await check('!document.querySelector(".v3-dashboard-details [role=status]")', 'work settled')
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: observerProbe })
  await go('/dashboard')
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('招聘工作台')
  await check('document.querySelector("[data-metric=positions]")?.textContent==="0"', 'real zero')
  if (process.env.R04_C === '1') {
    await check(
      'document.querySelectorAll(".v3-feedback[data-state=empty]").length===2',
      'both real empty regions'
    )
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll(".v3-feedback[data-state=empty]")].every(e=>e.querySelector("[role=status]") && getComputedStyle(e).borderTopStyle==="dashed")'
      )
    )
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll(".v3-dashboard-pager button")].every(e=>e.disabled)'
      )
    )
  }
  await snapshot('dashboard-empty')
  const pos = (
    await apiPost('/positions', {
      title: '虚构工作台岗位',
      department: '研发',
      location: '上海',
      publishDate: '2030-01-01',
      description: '隔离统计验证'
    })
  ).data.result.aggregateId
  const create = async (name) => {
    const r = await apiPost('/applications', {
      name,
      positionId: pos,
      appliedDate: '2030-01-01',
      owner: '虚构 HR'
    })
    assert.equal(r.status, 201)
    return r.data.result.aggregateId
  }
  const advance = async (id) => {
    const p = await apiGet('/applications/' + id + '/advance/preflight')
    assert.equal(
      (
        await apiPost('/applications/' + id + '/advance', {
          expectedVersion: p.version,
          targetStage: p.toStage,
          reason: '真实夹具豁免'
        })
      ).status,
      200
    )
  }
  const action = async (id, path, body = {}) => {
    const p = await apiGet('/applications/' + id)
    const r = await apiPost('/applications/' + id + path, { expectedVersion: p.version, ...body })
    assert.ok(r.status < 300, JSON.stringify(r.data))
    return r.data.result
  }
  const meeting = async (id, mode, time = '2030-01-01T14:00:00+08:00') => {
    const r = await action(id, '/interviews', { scheduledAt: time, interviewerName: '虚构专家' })
    if (mode === 'completed')
      await action(id, '/interviews/' + r.interviewId + '/complete', { interviewVersion: 1 })
    if (mode === 'cancelled')
      await action(id, '/interviews/' + r.interviewId + '/cancel', {
        interviewVersion: 1,
        reason: '真实取消'
      })
    return r.interviewId
  }
  const archivedPosition = await apiPost('/positions', {
    title: '归档但仍open的虚构职位',
    department: '研发',
    location: '上海',
    publishDate: '2030-01-01',
    description: '统计口径'
  })
  assert.equal(
    (
      await apiPost('/positions/' + archivedPosition.data.result.aggregateId + '/archive', {
        expectedVersion: 1
      })
    ).status,
    200
  )
  const screening = []
  for (let i = 0; i < 22; i++) screening.push(await create('筛选虚构申请 ' + i))
  const scheduling = await create('待安排虚构')
  await advance(scheduling)
  const due = await create('到时虚构')
  await advance(due)
  const dueMeeting = await meeting(due, 'scheduled')
  const feedback = await create('多场缺评虚构')
  await advance(feedback)
  await meeting(feedback, 'completed')
  await meeting(feedback, 'completed')
  const old = await create('历史缺评虚构')
  await advance(old)
  await meeting(old, 'completed')
  await advance(old)
  const decision = await create('待决策虚构')
  await advance(decision)
  const decisionMeeting = await meeting(decision, 'completed')
  await action(decision, '/interviews/' + decisionMeeting + '/feedback', {
    reviewerName: '虚构评价人',
    recommendation: 'recommend',
    reason: '真实评价'
  })
  const cancelled = await create('已取消虚构')
  await advance(cancelled)
  await meeting(cancelled, 'cancelled')
  const offerIds = []
  for (const status of ['preparing', 'sent', 'accepted', 'hired']) {
    const id = await create('Offer虚构' + status)
    await advance(id)
    await advance(id)
    await advance(id)
    if (status !== 'preparing') await action(id, '/offer/send')
    if (['accepted', 'hired'].includes(status)) await action(id, '/offer/accept')
    if (status === 'hired') await action(id, '/offer/confirm-hire')
    offerIds.push(id)
  }
  // Query refresh is read-only, including every exposed count and page.
  const counts = () =>
    JSON.stringify(
      db
        .prepare(
          'SELECT (SELECT count(*) FROM business_events) e,(SELECT count(*) FROM command_receipts) r'
        )
        .get()
    )
  const before = counts()
  await refresh()
  const metrics = { positions: '2', applications: String(screening.length + 9), hired: '1' }
  const sum = await apiGet('/dashboard/summary')
  metrics.applications = String(sum.activeApplications.count)
  for (const [key, value] of Object.entries(metrics))
    assert.equal(
      await evaluate('document.querySelector("[data-metric=' + key + ']").textContent'),
      value
    )
  assert.equal(sum.openPositions.softDeletedOpen, 1)
  assert.equal(sum.work.feedback.count, 2)
  assert.equal(sum.applicationTotals.hired, 1)
  assert.deepEqual(sum.offerByStatus, { preparing: 1, sent: 1, accepted: 1 })
  assert.equal(sum.work.due.count, 0)
  for (const [time, expected] of [
    ['2030-01-01T13:59:59+08:00', 0],
    ['2030-01-01T14:00:00+08:00', 1],
    ['2030-01-01T14:00:01+08:00', 1]
  ]) {
    fixtureNow = Date.parse(time)
    await refresh()
    const s = await apiGet('/dashboard/summary')
    assert.equal(s.work.due.count, expected)
    assert.equal((await apiGet('/interviews/' + dueMeeting)).status, 'scheduled')
  }
  await snapshot('dashboard-desktop')
  if (process.env.R04_AB === '1') await r04Checks()
  const refineMetrics = await tableChecks(
    { evaluate, send, width, check, snapshot },
    'dashboard-table',
    '.v3-dashboard-details .v3-table-scroll'
  )
  await writeFile(join(output, 'scroll-keyboard.json'), JSON.stringify(refineMetrics, null, 2))
  await selectedChecks({ evaluate, send, check, snapshot })
  if (process.env.R04_AB === '1') {
    await evaluate('document.querySelector("[data-work][aria-pressed=true]").focus()')
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      text: '\r',
      code: 'Enter',
      windowsVirtualKeyCode: 13
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13
    })
    assert.ok(
      await evaluate(
        '(()=>{const e=document.querySelector("[data-work][aria-pressed=true]");return e.matches(":focus-visible") && getComputedStyle(e).outlineStyle!=="none" && getComputedStyle(e).boxShadow!=="none"})()'
      )
    )
    await snapshot('r04-selected-focus')
  }
  await selection('screening')

  const firstScreen = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  if (process.env.R04_AB !== '1' && process.env.R04_C !== '1')
    await writeFile(
      join(output, 'dashboard-first-screen.png'),
      Buffer.from(firstScreen.data, 'base64')
    )
  for (const type of ['screening', 'scheduling', 'due', 'feedback', 'decision', 'offer']) {
    await selection(type)
    if (process.env.R04_AB === '1') {
      const option = await evaluate(
        'document.querySelector("[aria-label=待办类别]").selectedOptions[0].textContent'
      )
      assert.ok(
        (await evaluate('document.querySelector(".v3-dashboard-details h2").textContent')).includes(
          option
        )
      )
      assert.ok(
        requests.some(
          (url) =>
            new URL(url).pathname === '/api/v3/dashboard/work-items/' + type &&
            new URL(url).searchParams.get('offset') === '0'
        )
      )
    }
    const p = await apiGet('/dashboard/work-items/' + type + '?limit=10&offset=0')
    assert.equal(
      await evaluate('document.querySelectorAll(".v3-dashboard-details tbody tr").length'),
      p.items.length
    )
    const ui = await evaluate(
      '[...document.querySelectorAll(".v3-dashboard-details tbody tr")].map(r=>Number(r.dataset.application))'
    )
    assert.deepEqual(
      ui,
      p.items.map((r) => r.applicationId)
    )
    await snapshot('work-' + type)
  }
  await selection('screening')
  await button('下一页待办')
  await check(
    'document.querySelector(".v3-dashboard-pager")?.textContent.includes("第 11–20 条")',
    'next page'
  )
  const page = await apiGet('/dashboard/work-items/screening?limit=10&offset=10')
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".v3-dashboard-details tbody tr")].map(r=>Number(r.dataset.application))'
    ),
    page.items.map((r) => r.applicationId)
  )
  await button('下一页待办')
  await check(
    'document.querySelector(".v3-dashboard-pager")?.textContent.includes("第 21–22 条")',
    'last page actual item range'
  )
  await snapshot('dashboard-last-page')
  holdPath = '/api/v3/dashboard/work-items/screening'
  await button('刷新待办')
  await until(() => releaseHeld, 'held old read')
  await selection('feedback')
  await check(
    'document.querySelectorAll(".v3-dashboard-details tbody tr").length===2',
    'new result'
  )
  releaseHeld()
  releaseHeld = null
  await sleep(150)
  assert.equal(
    await evaluate('document.querySelectorAll(".v3-dashboard-details tbody tr").length'),
    2
  )
  await snapshot('dashboard-work-details')
  for (const status of ['preparing', 'sent', 'accepted']) {
    await selection('offer')
    await evaluate(
      '(()=>{const e=document.querySelector("[aria-label=\\"Offer 子状态\\"]");e.value=' +
        JSON.stringify(status) +
        ';e.dispatchEvent(new Event("change",{bubbles:true}))})()'
    )
    await check(
      'document.querySelectorAll(".v3-dashboard-details tbody tr").length===1',
      'Offer subtype'
    )
    const row = await apiGet('/dashboard/offer-work-items/' + status + '?limit=10&offset=0')
    assert.equal(
      await evaluate(
        'Number(document.querySelector(".v3-dashboard-details tbody tr").dataset.application)'
      ),
      row.items[0].applicationId
    )
  }
  await snapshot('dashboard-offer')
  const today = await apiGet('/dashboard/today-interviews?limit=10&offset=0')
  assert.equal(today.total, 6)
  assert.deepEqual(today.byStatus, { scheduled: 1, completed: 4, cancelled: 1 })
  await snapshot('dashboard-today')
  assert.equal(counts(), before)
  await click('.v3-dashboard-details a')
  await h1('申请详情')
  await check('!!document.querySelector(".v3-offer")', 'detail linked')
  await snapshot('dashboard-detail-link')
  await go('/dashboard')
  await h1('招聘工作台')
  await check('!!document.querySelector("[data-metric]")', 'ready')
  holdPath = '/api/v3/dashboard/summary'
  await button('刷新工作台')
  await until(() => releaseHeld, 'summary loading')
  if (process.env.R04_AB === '1') {
    await width(390)
    await check('innerWidth===390', 'loading mobile')
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    assert.equal(
      await evaluate(
        'getComputedStyle(document.querySelector(".v3-dashboard-metrics")).gridTemplateColumns.split(" ").length'
      ),
      2
    )
    await snapshot('r04-loading-390')
    await width(1440)
  }
  await snapshot('dashboard-loading')
  releaseHeld()
  releaseHeld = null
  await check('!!document.querySelector("[data-metric]")', 'summary recovers')
  failSummary = true
  await button('刷新工作台')
  await check('document.body.innerText.includes("暂时无法查看工作台指标")', 'summary fail')
  assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 0)
  if (process.env.R04_C === '1') {
    const card = 'document.querySelector(".v3-feedback[data-state=error]")'
    assert.ok(await evaluate(card + '.querySelector("[role=alert]")!==null'))
    assert.equal(await evaluate('getComputedStyle(' + card + ').borderInlineStartWidth'), '3px')
    await evaluate(card + '.querySelector("button").focus()')
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9
    })
    await evaluate(card + '.querySelector("button").focus()')
    assert.ok(await evaluate(card + '.querySelector("button").matches(":focus-visible")'))
    await snapshot('r04c-retry-focus')
  }
  await snapshot('dashboard-error')
  failSummary = false
  if (process.env.R04_C === '1') {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r'
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13
    })
  } else await button('重试指标')
  await check('!!document.querySelector("[data-metric]")', 'summary retry')
  if (process.env.R04_C === '1') {
    holdPath =
      '/api/v3/dashboard/work-items/' +
      (await evaluate('document.querySelector("[aria-label=待办类别]").value'))
    await button('刷新待办')
    await until(() => releaseHeld, 'work-only held read')
    assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 4)
    await width(1100)
    await snapshot('r04c-work-loading')
    releaseHeld()
    releaseHeld = null
    await check(
      '!document.querySelector(".v3-dashboard-details [role=status]")',
      'work-only load restored'
    )
    holdPath = '/api/v3/dashboard/today-interviews'
    await button('刷新今日面试')
    await until(() => releaseHeld, 'today-only held read')
    assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 4)
    await snapshot('r04c-today-loading')
    releaseHeld()
    releaseHeld = null
    await check(
      '!document.querySelector(".v3-dashboard-today [role=status]")',
      'today load restored'
    )
  }
  failWork = true
  await button('刷新待办')
  await check('document.body.innerText.includes("暂时无法查看待办")', 'work error')
  if (process.env.R04_C === '1') {
    assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 4)
    await snapshot('r04c-work-error')
  }
  failWork = false
  await button('重试待办')
  await check(
    'document.querySelectorAll(".v3-dashboard-details tbody tr").length===10',
    'work retry'
  )
  failToday = true
  await button('刷新今日面试')
  await check('document.body.innerText.includes("暂时无法查看今日面试")', 'today error')
  if (process.env.R04_C === '1') {
    await width(390)
    await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
    assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 4)
    await snapshot('r04c-today-error')
  }
  failToday = false
  await button('重试今日面试')
  await check('document.querySelectorAll(".v3-dashboard-today tbody tr").length===6', 'today retry')
  denySummary = true
  await button('刷新工作台')
  await check('document.body.innerText.includes("登录状态仍有效")', 'operation403')
  await button('重试指标')
  await check('!!document.querySelector("[data-metric]")', 'valid identity retained')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'))
  await snapshot('dashboard-mobile')
  await width(1440)
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users(username,password_hash,name,role,department,email,phone)VALUES(?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二虚构HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('招聘工作台')
  await check('!!document.querySelector("[data-metric]")', 'new account data')
  db.prepare("UPDATE users SET role='viewer' WHERE username='second-hr'").run()
  await button('刷新工作台')
  await h1('登录招聘工作台')
  assert.equal(await evaluate('document.querySelectorAll("[data-metric]").length'), 0)
  assert.equal(requests.filter((u) => /^\/api\/(?!v3\/)/.test(new URL(u).pathname)).length, 0)

  await width(1440)
  await evaluate('document.querySelector(".v3-account a")?.click()')
  await check('document.querySelectorAll(".v3-table-scroll").length===0', 'table route unmounted')
  assert.equal(
    await evaluate('window.__tableObservers?.size ?? 0'),
    0,
    'scroll ResizeObservers disconnected'
  )
  assert.equal(browserWrites.length, 0, 'Dashboard interactions cannot issue business writes')
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        passed: true,
        r04c:
          process.env.R04_C === '1'
            ? {
                independentLoading: ['summary', 'work', 'today'],
                independentErrorsAndRetry: ['summary', 'work', 'today'],
                emptyStatusAndDashedBorder: true,
                emptyPaginationDisabled: true,
                keyboardEnterRetryAndVisibleFocus: true,
                screenshotsAtWidths: [1440, 1100, 390],
                businessWritesFromDashboard: 0
              }
            : undefined,
        fixtures: 'fresh V3 memory DB, real HTTP commands and frozen Shanghai clock',
        checks: [
          'real empty/zero',
          'six types and exact source rows',
          'multiple feedback items, historical missing excluded',
          'Offer accepted separate from hired',
          'three reminder boundaries preserve scheduled',
          'Shanghai today byStatus',
          'server pages, old-response discard',
          'refresh no business writes',
          'detail routing',
          'loading and independent error retry',
          'operation403, account switch, actual role revocation',
          '1440/390 no overflow',
          'zero V2 requests'
        ],
        limitations: [
          'time window extremes additionally covered by backend tests',
          'not formal full AC acceptance'
        ]
      },
      null,
      2
    )
  )
  console.log('PASS UI-05 real Dashboard Chromium checks')
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
  Date.now = originalNow
}
