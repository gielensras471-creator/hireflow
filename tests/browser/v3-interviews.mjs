import { tableChecks, observerProbe } from './refine-list-checks.mjs'
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
let releaseOpen = null,
  holdOpen = false,
  failOpen = false,
  failEmbedded = false
let alignVersion = false,
  slowOnce = false
let deny = false,
  drop = false,
  failMe = false,
  failList = false
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
wrapped.use(express.json())
wrapped.use((req, res, next) => {
  const applicationDetail =
    req.method === 'GET' &&
    req.path.startsWith('/api/v3/applications/') &&
    req.path.split('/').length === 5
  if (applicationDetail && holdOpen) {
    holdOpen = false
    releaseOpen = () => next()
    return
  }
  if (applicationDetail && failOpen) {
    failOpen = false
    return res.status(503).json({ error: { code: 'FIXTURE_OPEN_FAILED', message: 'fixture' } })
  }
  if (
    failEmbedded &&
    req.method === 'GET' &&
    req.path.startsWith('/api/v3/applications/') &&
    req.path.endsWith('/interviews')
  )
    return res.status(503).json({ error: { code: 'FIXTURE_READ_FAILED', message: 'fixture' } })
  if (slowOnce && req.method === 'GET' && req.path === '/api/v3/interviews') {
    slowOnce = false
    return setTimeout(() => {
      if (failList)
        return res.status(503).json({ error: { code: 'FIXTURE_READ_FAILED', message: 'fixture' } })
      next()
    }, 2500)
  }
  if (alignVersion && req.method === 'POST' && req.path.endsWith('/reschedule')) {
    alignVersion = false
    req.body.expectedVersion = db
      .prepare('SELECT version FROM candidates WHERE id=?')
      .get(Number(req.path.split('/')[4])).version
  }
  if (req.method === 'GET' && req.path === '/api/v3/interviews' && req.query.q === 'slow')
    return setTimeout(next, 2500)
  if (failMe && req.path === '/api/v3/auth/me')
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (failList && req.method === 'GET' && req.path === '/api/v3/interviews')
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (deny && req.method === 'POST') {
    deny = false
    return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
  }
  if (
    drop &&
    req.method === 'POST' &&
    req.path.startsWith('/api/v3/applications/') &&
    req.path.endsWith('/interviews')
  ) {
    drop = false
    res.json = () => {
      res.socket.destroy()
      return res
    }
  }
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
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
    if (
      m.method === 'Network.responseReceived' &&
      m.params.response.url.endsWith('/api/v3/auth/me')
    )
      meStatuses.push(m.params.response.status)
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
  const pos = await apiPost('/positions', {
    title: '虚构研发职位',
    department: '研发',
    location: '上海',
    description: '面试验收专用',
    publishDate: '2030-01-01'
  })
  assert.equal(pos.status, 201)
  const positionId = pos.data.result.aggregateId
  const create = async (name) => {
    const r = await apiPost('/applications', {
      name,
      positionId,
      owner: '演示 HR',
      appliedDate: '2030-01-01'
    })
    assert.equal(r.status, 201)
    return r.data.result.aggregateId
  }
  const screening = await create('筛选阶段虚构申请')
  const first = await create('初面虚构申请')
  const second = await create('复面虚构申请')
  const closed = await create('已关闭虚构申请')
  const advance = async (id) => {
    const current = await apiGet('/applications/' + id)
    const r = await apiPost('/applications/' + id + '/advance', {
      expectedVersion: current.version,
      reason: '隔离夹具明确推进，缺评按真实豁免记录'
    })
    assert.equal(r.status, 200)
  }
  await advance(first)
  await advance(second)
  await advance(second)
  const currentClosed = await apiGet('/applications/' + closed)
  assert.equal(
    (
      await apiPost('/applications/' + closed + '/close', {
        expectedVersion: currentClosed.version,
        outcome: 'candidate_withdrew',
        reason: '虚构测试退出'
      })
    ).status,
    200
  )
  const button = async (text, scope = 'document') => {
    const expression =
      '([...(' +
      scope +
      '?.querySelectorAll("button")??[])].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      ' && !e.disabled))'
    await check(expression + ' !== undefined', 'button ' + text)
    await evaluate(expression + '.click()')
  }
  const input = async (label, value) => {
    const selector = JSON.stringify('[aria-label="' + label + '"]')
    await check('!!document.querySelector(' + selector + ')', 'input ' + label)
    return evaluate(
      '(()=>{const e=document.querySelector(' +
        selector +
        ');e.value=' +
        JSON.stringify(value) +
        ';e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()'
    )
  }
  const save = async () => {
    await check('!!document.querySelector(".v3-interview-editor form")', 'interview editor')
    await evaluate('document.querySelector(".v3-interview-editor form").requestSubmit()')
  }
  const detailPage = async (id) => {
    await go('/candidates/' + id)
    await h1('申请详情')
    await check('!!document.querySelector(".v3-interviews .v3-card")', 'interview region')
  }
  const rowScope = (id) => 'document.querySelector("[data-interview-id=\\"' + id + '\\"]")'
  const schedule = async (id, time = '2030-01-01T14:00:00') => {
    await detailPage(id)
    await button('安排面试', 'document.querySelector(".v3-interviews")')
    await input('预约开始时间', time)
    await input('专业面试官姓名', '虚构专业面试官')
    await input('面试备注', '隔离验收备注')
    await snapshot('schedule-form')
    await save()
    await check('!document.querySelector(".v3-interview-editor")', 'schedule saved')
    await check('!!document.querySelector(".v3-interviews tbody tr")', 'interview displayed')
    return (await apiGet('/applications/' + id + '/interviews')).at(-1).id
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: observerProbe })
  await go('/interviews')
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('面试管理')
  await check('document.body.innerText.includes("暂时没有面试记录")', 'true empty')
  await snapshot('interviews-empty')
  await detailPage(screening)
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )
  await detailPage(closed)
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )

  await detailPage(first)
  holdOpen = true
  await button('安排面试', 'document.querySelector(".v3-interviews")')
  await until(() => releaseOpen, 'held interview open')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="编辑申请资料").disabled'
    )
  )
  await evaluate(
    '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="编辑申请资料").click()'
  )
  releaseOpen()
  releaseOpen = null
  await check('!!document.querySelector(".v3-interview-editor")', 'sole interview editor')
  assert.equal(await evaluate('document.querySelectorAll(".v3-editor").length'), 0)
  await snapshot('interview-open-exclusive')
  await input('专业面试官姓名', '互斥草稿')
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await sleep(150)
  assert.equal(await evaluate('document.querySelector("h1").textContent'), '申请详情')
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"专业面试官姓名\\"]").value'),
    '互斥草稿'
  )
  dialogMode = true
  await button('返回', 'document.querySelector(".v3-interview-editor")')
  await check('!document.querySelector(".v3-interview-editor")', 'interview release')
  holdOpen = true
  await button('编辑申请资料')
  await until(() => releaseOpen, 'held profile open')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )
  await evaluate(
    '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").click()'
  )
  releaseOpen()
  releaseOpen = null
  await check('!!document.querySelector(".v3-editor")', 'sole profile editor')
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-editor").length'), 0)
  await snapshot('profile-open-exclusive')
  await input('姓名', '资料草稿仍存在')
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await sleep(150)
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"姓名\\"]").value'),
    '资料草稿仍存在'
  )
  dialogMode = true
  await button('取消', 'document.querySelector(".v3-editor")')
  await check('!document.querySelector(".v3-editor")', 'profile release')
  holdOpen = true
  await button('安排面试', 'document.querySelector(".v3-interviews")')
  await until(() => releaseOpen, 'held open before unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  releaseOpen()
  releaseOpen = null
  await sleep(200)
  assert.equal(
    await evaluate('document.querySelectorAll(".v3-editor,.v3-interview-editor").length'),
    0
  )
  await detailPage(first)
  failOpen = true
  await button('安排面试', 'document.querySelector(".v3-interviews")')
  await check('document.querySelector(".v3-interviews [role=alert]") !== null', 'failed open')
  await button('编辑申请资料')
  await check('!!document.querySelector(".v3-editor")', 'failed opening releases lease')
  await button('取消', 'document.querySelector(".v3-editor")')
  await check('!document.querySelector(".v3-editor")', 'editor close')

  const id = await schedule(first)
  assert.equal((await apiGet('/applications/' + first)).stage, 'first_interview')
  const r1 = await apiGet('/interviews/' + id)
  assert.equal(r1.startTimeReached, false)
  assert.equal(r1.status, 'scheduled')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )
  const a = await apiGet('/applications/' + first)
  const duplicate = await apiPost('/applications/' + first + '/interviews', {
    expectedVersion: a.version,
    scheduledAt: '2030-01-01T14:00:00+08:00',
    interviewerName: '并行虚构面试官'
  })
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.data.error.code, 'INTERVIEW_ALREADY_SCHEDULED')
  await snapshot('application-interview')

  failEmbedded = true
  await button('刷新面试记录', 'document.querySelector(".v3-interviews")')
  await check(
    'document.querySelector(".v3-interviews")?.textContent.includes("暂时无法查看面试记录")',
    'embedded error'
  )
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].filter(e=>e.textContent.trim()==="安排面试"&&!e.disabled).length'
    ),
    0
  )
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-editor").length'), 0)
  await snapshot('failed-refresh-blocked')
  failEmbedded = false
  await button('重新加载', 'document.querySelector(".v3-interviews")')
  await check('!!document.querySelector(".v3-interviews tbody tr")', 'embedded recover')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )
  await button('改期', rowScope(id))
  await check('!!document.querySelector(".v3-interview-editor")', 'recovered legal action')
  await button('返回', 'document.querySelector(".v3-interview-editor")')
  await check('!document.querySelector(".v3-interview-editor")', 'return from recovered editor')

  for (const [local, due] of [
    ['2030-01-01T13:59:59+08:00', false],
    ['2030-01-01T14:00:00+08:00', true],
    ['2030-01-01T14:00:01+08:00', true]
  ]) {
    fixtureNow = Date.parse(local)
    const actual = await apiGet('/interviews/' + id)
    assert.equal(actual.startTimeReached, due)
    assert.equal(actual.status, 'scheduled')
  }
  await detailPage(first)
  await check(
    'document.querySelector(".v3-reminder")?.textContent.includes("预约开始时间已到")',
    'server due reminder'
  )
  await snapshot('due-reminder')
  await button('改期', rowScope(id))
  await input('预约开始时间', '2030-01-01T15:00:00')
  await snapshot('reschedule-form')
  await save()
  await check('!document.querySelector(".v3-interview-editor")', 'reschedule saved')
  assert.equal((await apiGet('/interviews/' + id)).scheduledLocal, '2030-01-01T15:00:00+08:00')
  await check('!!document.querySelector("[data-interview-id=\\"' + id + '\\"]")', 'record ready')
  await button('改期', rowScope(id))
  await input('预约开始时间', '2030-01-01T16:00:00')
  const old = await apiGet('/applications/' + first)
  assert.equal(
    (
      await apiPost(
        '/applications/' + first,
        { expectedVersion: old.version, note: '并发资料变更' },
        'PATCH'
      )
    ).status,
    200
  )
  await save()
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("申请版本")',
    'application conflict authority'
  )
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"预约开始时间\\"]").value'),
    '2030-01-01T16:00'
  )
  await snapshot('application-version-conflict')
  dialogMode = true
  await button('确认按新版本重新提交')
  await check('!document.querySelector(".v3-interview-editor")', 'new application intent saved')
  await check('!!document.querySelector("[data-interview-id=\\"' + id + '\\"]")', 'ready')
  await button('改期', rowScope(id))
  await input('预约开始时间', '2030-01-01T17:00:00')
  const before = await apiGet('/interviews/' + id)
  assert.equal(
    (
      await apiPost('/applications/' + first + '/interviews/' + id + '/reschedule', {
        expectedVersion: before.applicationVersion,
        interviewVersion: before.interviewVersion,
        scheduledAt: '2030-01-01T16:30:00+08:00'
      })
    ).status,
    200
  )
  alignVersion = true
  await save()
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("面试版本")',
    'meeting conflict authority'
  )
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("面试已有新进展")',
    'actual interview version conflict code'
  )
  await snapshot('interview-version-conflict')
  await button('确认按新版本重新提交')
  await check('!document.querySelector(".v3-interview-editor")', 'meeting conflict resolved')
  await check('!!document.querySelector("[data-interview-id=\\"' + id + '\\"]")', 'ready')
  await button('确认完成', rowScope(id))
  await check(
    '!!document.querySelector(".v3-interview-editor form")',
    'completion confirmation ready'
  )
  await snapshot('complete-confirmation')
  await save()
  await check('!document.querySelector(".v3-interview-editor")', 'complete saved')
  assert.equal((await apiGet('/interviews/' + id)).status, 'completed')
  assert.equal((await apiGet('/applications/' + first)).stage, 'first_interview')
  await check(
    '!!document.querySelector("[data-interview-id=\\"' + id + '\\"]")',
    'completed visible'
  )
  await snapshot('completed')
  const secondId = await schedule(second, '2030-01-01T15:00:00')
  assert.equal((await apiGet('/interviews/' + secondId)).stageScope, 'second_interview')
  await button('取消面试', rowScope(secondId))
  await check('!!document.querySelector(".v3-interview-editor form")', 'cancel form ready')
  await evaluate('document.querySelector(".v3-interview-editor form").noValidate=true')
  await save()
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("请填写取消原因")',
    'cancel requires reason'
  )
  await input('取消原因', '虚构面试官时间调整')
  await snapshot('cancel-reason')
  await save()
  await check('!document.querySelector(".v3-interview-editor")', 'cancel saved')
  assert.equal((await apiGet('/interviews/' + secondId)).status, 'cancelled')
  await check(
    '!!document.querySelector("[data-interview-id=\\"' + secondId + '\\"]")',
    'cancel visible'
  )
  assert.equal((await apiGet('/interviews/' + secondId)).cancelReason, '虚构面试官时间调整')
  await snapshot('cancelled')
  await button('安排面试', 'document.querySelector(".v3-interviews")')
  await input('预约开始时间', '2030-01-02T14:00:00')
  await input('专业面试官姓名', '虚构补约面试官')
  drop = true
  await save()
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("本次操作结果尚未确认")',
    'uncertain schedule'
  )
  await snapshot('uncertain-schedule')
  await save()
  await check('!document.querySelector(".v3-interview-editor")', 'schedule replay')
  assert.equal((await apiGet('/applications/' + second + '/interviews')).length, 2)
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM business_events WHERE candidate_id=? AND event_type='interview_scheduled'"
      )
      .get(second).n,
    2
  )
  // More rows use real API writes, then completion, allowing sequential bookings.
  for (let n = 0; n < 20; n++) {
    const current = await apiGet('/applications/' + first)
    const res = await apiPost('/applications/' + first + '/interviews', {
      expectedVersion: current.version,
      scheduledAt: '2030-01-03T14:00:00+08:00',
      interviewerName: '分页虚构面试官'
    })
    assert.equal(res.status, 201)
    const meeting = res.data.result.interviewId
    const row = await apiGet('/interviews/' + meeting)
    assert.equal(
      (
        await apiPost('/applications/' + first + '/interviews/' + meeting + '/complete', {
          expectedVersion: row.applicationVersion,
          interviewVersion: row.interviewVersion
        })
      ).status,
      200
    )
  }
  await go('/interviews')
  await h1('面试管理')
  await check(
    'document.querySelectorAll(".v3-interviews tbody tr").length===20',
    'bounded first page'
  )
  await snapshot('interviews-desktop')
  const refineMetrics = await tableChecks(
    { evaluate, send, width, check, snapshot },
    'interviews-table',
    '.v3-table-scroll'
  )
  await writeFile(join(output, 'scroll-keyboard.json'), JSON.stringify(refineMetrics, null, 2))

  await button('下一页')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===3', 'second page')
  await button('上一页')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===20', 'previous page')
  await input('面试状态', 'cancelled')
  await evaluate('document.querySelector(".v3-interview-filters").requestSubmit()')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===1', 'status filter')
  await input('申请 ID', String(first))
  await evaluate('document.querySelector(".v3-interview-filters").requestSubmit()')
  await check('document.body.innerText.includes("没有匹配的面试记录")', 'filtered empty')
  failList = true
  slowOnce = true
  await button('清除筛选')
  await check('!!document.querySelector(".v3-interview-loading")', 'slow failing read loading')
  await check('document.body.innerText.includes("暂时无法查看面试记录")', 'list failure')
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-loading").length'), 0)
  await snapshot('interviews-error')
  failList = false
  await button('重新加载')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===20', 'retry')
  slowOnce = true
  await input('面试状态', 'scheduled')
  await evaluate('document.querySelector(".v3-interview-filters").requestSubmit()')
  await check('document.body.innerText.includes("加载面试记录中")', 'pending filter')

  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".v3-interview-loading th")].map(e=>e.textContent)'
    ),
    ['面试 / 申请', '应聘职位', '轮次', '预约开始时间（上海）', '面试官', '状态', '操作']
  )
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-loading-row").length'), 5)
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-loading-cell").length'), 35)
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".v3-interviews tbody button,.v3-interviews [data-interview-id]").length'
    ),
    0
  )
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-interview-loading").getAttribute("aria-busy")==="true" && document.querySelector(".v3-interview-loading tbody").getAttribute("aria-hidden")==="true"'
    )
  )
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-interview-loading [role=status]").textContent.includes("加载面试记录中")'
    )
  )
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"面试状态\\"]").value'),
    'scheduled'
  )
  assert.ok(
    await evaluate(
      '!document.querySelector(".v3-interview-loading").textContent.includes("共 23 场")'
    )
  )
  await snapshot('interviews-loading')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'loading mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'))
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-interview-loading .v3-table-scroll").scrollWidth>document.querySelector(".v3-interview-loading .v3-table-scroll").clientWidth'
    )
  )
  await width(1440)

  await input('面试状态', 'completed')
  await evaluate('document.querySelector(".v3-interview-filters").requestSubmit()')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===20', 'new filter')
  await sleep(3000)
  assert.equal(await evaluate('document.querySelectorAll(".v3-interviews tbody tr").length'), 20)
  assert.equal(await evaluate('document.querySelectorAll(".v3-interview-loading-cell").length'), 0)
  slowOnce = true
  await input('面试状态', 'scheduled')
  await evaluate('document.querySelector(".v3-interview-filters").requestSubmit()')
  await check('document.body.innerText.includes("加载面试记录中")', 'pending before unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  await sleep(3000)
  assert.equal(await evaluate('document.querySelector("h1").textContent'), '职位管理')
  await go('/interviews')
  await h1('面试管理')
  await check('document.querySelectorAll(".v3-interviews tbody tr").length===20', 'list again')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'))
  await snapshot('interviews-mobile')
  await width(1440)
  // New intent cannot survive an explicit account switch.
  await detailPage(second)
  const live = (await apiGet('/applications/' + second + '/interviews')).find(
    (x) => x.status === 'scheduled'
  )
  await button('改期', rowScope(live.id))
  await input('预约开始时间', '2030-01-04T14:00:00')
  deny = true
  await save()
  await check(
    'document.querySelector(".v3-interview-editor")?.textContent.includes("登录状态仍有效")',
    'operation 403'
  )
  failMe = true
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await check('document.body.innerText.includes("连接暂时中断")', 'identity outage')
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"预约开始时间\\"]").value'),
    '2030-01-04T14:00'
  )
  failMe = false
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二位演示 HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('招聘工作台')
  assert.ok(await evaluate('!document.querySelector(".v3-interview-editor")'))
  assert.equal((await apiGet('/interviews/' + live.id)).scheduledLocal, '2030-01-02T14:00:00+08:00')
  await advance(first)
  await detailPage(first)
  await check(
    'document.querySelectorAll(".v3-interviews tbody tr").length===21',
    'historical round rows'
  )
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews tbody tr")].every(row=>row.innerText.includes("历史轮次"))'
    )
  )
  await snapshot('historical-round')
  db.prepare("UPDATE users SET role='viewer' WHERE username='second-hr'").run()
  await evaluate(
    'import("/src/api/request-v3.ts").then(m=>m.readV3("/interviews")).catch(()=>null)'
  )
  await h1('登录招聘工作台')
  assert.equal(requests.filter((url) => /^\/api\/(?!v3\/)/.test(new URL(url).pathname)).length, 0)

  await width(1440)
  await evaluate('document.querySelector(".v3-account a")?.click()')
  await check('document.querySelectorAll(".v3-table-scroll").length===0', 'table route unmounted')
  assert.equal(
    await evaluate('window.__tableObservers?.size ?? 0'),
    0,
    'scroll ResizeObservers disconnected'
  )
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        editorOpeningMutex: true,
        pendingOpenUnmount: true,
        failedOpenRelease: true,
        failedRefreshBlocked: true,
        draftLeaveConfirmation: true,
        bookFirst: true,
        bookSecond: true,
        screeningClosedBlocked: true,
        parallelBlocked: true,
        reschedule: true,
        completeDoesNotAdvance: true,
        cancelReason: true,
        rebookAfterCancel: true,
        serverTimeBoundaries: ['13:59:59 false', '14:00:00 true', '14:00:01 true'],
        applicationConflict: true,
        interviewConflict: true,
        sameKeyReplay: true,
        paging: '20/3',
        filterRace: true,
        unmountRace: true,
        accountIsolation: true,
        operation403: true,
        roleRevocation: true,
        identityOutage: true,
        mobile390: true,
        v2Requests: 0
      },
      null,
      2
    )
  )
  console.log(
    'PASS UI-03A real V3 interview workflow, dual conflicts, Shanghai boundaries, replay, paging, identity and zero V2 requests'
  )
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
  Date.now = originalNow
}
