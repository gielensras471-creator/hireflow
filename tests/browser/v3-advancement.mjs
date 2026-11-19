import { checkSummary } from './r03b-summary-checks.mjs'
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
let holdResponse = false,
  releaseResponse = null
const dialogs = []
let unauthorized = false
let holdPath = null,
  releaseHeld = null,
  deny = false,
  drop = false,
  failMe = false,
  failPreflight = false,
  slowPreflight = false,
  failHistory = false,
  raceAdvance = null
const browserWrites = []
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
wrapped.use(express.json())
wrapped.use(async (req, res, next) => {
  if (req.method === 'GET' && req.path === holdPath) {
    holdPath = null
    releaseHeld = () => next()
    return
  }
  if (req.method === 'GET' && req.path.endsWith('/advance/preflight')) {
    if (unauthorized)
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'fixture' } })
    if (failPreflight)
      return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
    if (slowPreflight) {
      slowPreflight = false
      return setTimeout(next, 2000)
    }
  }
  if (req.path.endsWith('/advancement/history') && failHistory)
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (req.path === '/api/v3/auth/me' && failMe)
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (req.method === 'POST' && req.path.endsWith('/advance')) {
    browserWrites.push({ key: req.get('Idempotency-Key'), body: JSON.stringify(req.body) })
    if (deny) {
      deny = false
      return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
    }
    if (raceAdvance) {
      const action = raceAdvance
      raceAdvance = null
      await action()
    }
    if (holdResponse) {
      holdResponse = false
      const original = res.json.bind(res)
      res.json = (body) => {
        releaseResponse = () => original(body)
        return res
      }
    }
    if (drop) {
      drop = false
      res.json = () => {
        res.socket.destroy()
        return res
      }
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
    api.closeAllConnections()
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
  await checkSummary({ evaluate, db, output, name })
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

  const pos = await apiPost('/positions', {
    title: '虚构晋级职位',
    department: '研发',
    location: '上海',
    publishDate: '2030-01-01',
    description: '隔离验收'
  })
  const positionId = pos.data.result.aggregateId
  const create = async (name) => {
    const r = await apiPost('/applications', {
      positionId,
      name,
      owner: '虚构负责人',
      appliedDate: '2030-01-01'
    })
    assert.equal(r.status, 201)
    return r.data.result.aggregateId
  }
  const advance = async (id) => {
    const p = await apiGet('/applications/' + id + '/advance/preflight')
    const r = await apiPost('/applications/' + id + '/advance', {
      expectedVersion: p.version,
      targetStage: p.toStage,
      reason: '合法夹具推进理由'
    })
    assert.equal(r.status, 200)
  }
  const book = async (id, complete = true, feedback = null) => {
    let a = await apiGet('/applications/' + id)
    const r = await apiPost('/applications/' + id + '/interviews', {
      expectedVersion: a.version,
      scheduledAt: '2030-01-01T14:00:00+08:00',
      interviewerName: '虚构面试官'
    })
    assert.equal(r.status, 201)
    const meeting = r.data.result.interviewId
    if (complete) {
      a = await apiGet('/applications/' + id)
      assert.equal(
        (
          await apiPost('/applications/' + id + '/interviews/' + meeting + '/complete', {
            expectedVersion: a.version,
            interviewVersion: 1
          })
        ).status,
        200
      )
    }
    if (feedback) {
      a = await apiGet('/applications/' + id)
      assert.equal(
        (
          await apiPost('/applications/' + id + '/interviews/' + meeting + '/feedback', {
            expectedVersion: a.version,
            reviewerName: '虚构专家',
            recommendation: feedback,
            reason: '真实测试依据，不自动决定晋级'
          })
        ).status,
        201
      )
    }
    return meeting
  }
  const main = await create('顺序晋级虚构申请')
  const missing = await create('多场缺评虚构申请')
  await advance(missing)
  const m1 = await book(missing),
    m2 = await book(missing),
    rated = await book(missing, true, 'not_recommend')
  const scheduled = await create('未处理预约虚构申请')
  await advance(scheduled)
  const pendingMeeting = await book(scheduled, false)
  const skip = await create('跳过评估虚构申请')
  await advance(skip)
  const closed = await create('关闭虚构申请')
  assert.equal(
    (
      await apiPost('/applications/' + closed + '/close', {
        expectedVersion: 1,
        outcome: 'candidate_withdrew',
        reason: '虚构退出'
      })
    ).status,
    200
  )
  const race = await create('并发虚构申请')
  await advance(race)
  const button = async (text, scope = 'document') => {
    const expr =
      '([...(' +
      scope +
      '?.querySelectorAll("button")??[])].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      '&&!e.disabled))'
    await check(expr + '!==undefined', 'button ' + text)
    await evaluate(expr + '.click()')
  }
  const input = async (label, value) => {
    await evaluate(
      '(()=>{const e=document.querySelector(' +
        JSON.stringify('[aria-label="' + label + '"]') +
        ');e.value=' +
        JSON.stringify(value) +
        ';e.dispatchEvent(new Event("input",{bubbles:true}))})()'
    )
  }
  const panel = 'document.querySelector(".v3-advancement")',
    ed = 'document.querySelector(".v3-advance-editor")'
  const detail = async (id) => {
    await go('/candidates/' + id)
    await h1('申请详情')
    await check(
      '!!document.querySelector(".v3-advancement")&&!document.querySelector(".v3-advance-loading")',
      'preflight loaded'
    )
  }
  const save = () => evaluate(ed + '.querySelector("form").requestSubmit()')
  const done = async () => {
    await check('!document.querySelector(".v3-advance-editor")', 'editor closed')
    await check(
      '!!document.querySelector(".v3-advancement")&&!document.querySelector(".v3-advance-loading")',
      'state refreshed'
    )
  }
  const count = () =>
    db
      .prepare(
        'SELECT (SELECT count(*) FROM business_events) events,(SELECT count(*) FROM command_receipts) receipts'
      )
      .get()
  const editors =
    'document.querySelectorAll(".v3-advance-editor,.v3-feedback-editor,.v3-interview-editor,.v3-editor").length'
  await go('/candidates/' + main)
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('申请详情')
  await check(panel + '.textContent.includes("暂无真实晋级事件")', 'empty history')
  await snapshot('advance-empty')
  holdPath = '/api/v3/applications/' + main + '/advance/preflight'
  await button('核验并决定晋级', panel)
  await until(() => releaseHeld, 'held open')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="编辑申请资料").disabled'
    )
  )
  releaseHeld()
  releaseHeld = null
  await check(editors + '===1', 'single editor')
  await snapshot('advance-normal-confirm')
  dialogMode = false
  await save()
  await sleep(150)
  assert.equal((await apiGet('/applications/' + main)).stage, 'screening')
  dialogMode = true
  const pendingBefore = count(),
    writesBefore = browserWrites.length
  holdResponse = true
  await Promise.all([save(), save()])
  await until(() => releaseResponse, 'actual committed write response held')
  assert.equal(browserWrites.length, writesBefore + 1)
  assert.ok(!Object.hasOwn(JSON.parse(browserWrites.at(-1).body), 'reason'))
  assert.deepEqual(
    { ...count() },
    { events: pendingBefore.events + 1, receipts: pendingBefore.receipts + 1 }
  )
  await check(ed + '.textContent.includes("离开页面不会撤销晋级")', 'pending status')
  dialogMode = false
  const dialogCount = dialogs.length
  await click('.v3-sidebar a[href="/positions"]')
  await until(() => dialogs.length > dialogCount, 'pending empty-reason leave dialog')
  assert.match(dialogs.at(-1), /服务器可能已保存/)
  await check(editors + '===1', 'cancel leave retains editor')
  assert.equal(await evaluate('document.querySelector("h1").textContent'), '申请详情')
  assert.equal(browserWrites.length, writesBefore + 1)
  await snapshot('advance-pending-leave')
  releaseResponse()
  releaseResponse = null
  await done()
  assert.deepEqual(
    { ...count() },
    { events: pendingBefore.events + 1, receipts: pendingBefore.receipts + 1 }
  )
  const protection = await evaluate(
    'import("/src/router/v3-drafts.ts").then(m=>({dirty:m.v3DraftDirty.value,uncertain:m.v3UncertainWrite.value}))'
  )
  assert.deepEqual(protection, { dirty: false, uncertain: false })
  const afterSuccessDialogs = dialogs.length
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  assert.equal(dialogs.length, afterSuccessDialogs)
  assert.equal((await apiGet('/applications/' + main)).stage, 'first_interview')
  evidence.push(
    'FIX-01 empty-reason in-flight navigation: one HTTP write/event/receipt, leave warning, cancel keeps intent, successful response clears dirty state'
  )
  dialogMode = true
  await book(main, true, 'recommend')
  assert.equal((await apiGet('/applications/' + main)).stage, 'first_interview')
  await detail(main)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'normal editor')
  await save()
  await done()
  assert.equal((await apiGet('/applications/' + main)).stage, 'second_interview')
  await book(main, true, 'recommend')
  await detail(main)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'offer editor')
  await save()
  await done()
  assert.equal((await apiGet('/applications/' + main)).offerStatus, 'preparing')
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".v3-advancement button")].find(b=>b.textContent.trim()==="核验并决定晋级").disabled'
    ),
    true
  )
  evidence.push(
    'three explicit sequential transitions, complete and recommend do not auto-advance, Offer preparing and no next-stage'
  )
  await detail(scheduled)
  assert.ok(await evaluate(panel + '.textContent.includes("待处理预约 #' + pendingMeeting + '")'))
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-advancement button")].find(b=>b.textContent.trim()==="核验并决定晋级").disabled'
    )
  )
  await snapshot('advance-scheduled-block')
  const sp = await apiGet('/applications/' + scheduled + '/advance/preflight')
  assert.equal(
    (
      await apiPost('/applications/' + scheduled + '/advance', {
        expectedVersion: sp.version,
        targetStage: sp.toStage,
        reason: '尝试绕过'
      })
    ).status,
    409
  )
  await detail(closed)
  assert.ok(await evaluate(panel + '.textContent.includes("招聘已结束")'))
  assert.equal(
    (
      await apiPost('/applications/' + closed + '/advance', {
        expectedVersion: 2,
        targetStage: 'first_interview'
      })
    ).status,
    409
  )
  const sk = await apiGet('/applications/' + skip)
  assert.equal(
    (
      await apiPost('/applications/' + skip + '/advance', {
        expectedVersion: sk.version,
        targetStage: 'offer',
        reason: '跳轮'
      })
    ).status,
    422
  )
  evidence.push('scheduled cannot be waived; closed, Offer and illegal jumps denied')
  await detail(missing)
  await check(panel + '.textContent.includes("不推荐通过")', 'negative recommendation visible')
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'missing editor')
  await save()
  await check(ed + '.textContent.includes("非空晋级业务理由")', 'empty reason')
  assert.ok(
    await evaluate(
      ed + '.textContent.includes("#' + m1 + '")&&' + ed + '.textContent.includes("#' + m2 + '")'
    )
  )
  await input('晋级理由', '优先推进，同时保留两场缺评事实')
  await snapshot('advance-missing-reason')
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await sleep(150)
  assert.equal(await evaluate(editors), 1)
  dialogMode = true
  await save()
  await done()
  const historyBefore = await apiGet('/applications/' + missing + '/advancement/history')
  assert.equal(historyBefore.at(-1).kind, 'missing_feedback')
  assert.equal(historyBefore.at(-1).missingInterviews.length, 2)
  const a = await apiGet('/applications/' + missing)
  assert.equal(
    (
      await apiPost('/applications/' + missing + '/interviews/' + m1 + '/feedback/supplement', {
        expectedVersion: a.version,
        reviewerName: '虚构补录专家',
        recommendation: 'undecided',
        reason: '实际补录'
      })
    ).status,
    201
  )
  assert.deepEqual(await apiGet('/applications/' + missing + '/advancement/history'), historyBefore)
  await detail(missing)
  await check(panel + '.textContent.includes("当时的缺评事实")', 'immutable missing history')
  await snapshot('advance-real-history')
  evidence.push(
    'all missing IDs, negative recommendation does not veto, required reason, real immutable waiver/history after supplement, draft leave'
  )
  await detail(skip)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'skip editor')
  await snapshot('advance-skip-confirm')
  await input('晋级理由', '本轮按已知材料跳过评估')
  await save()
  await done()
  assert.equal(
    (await apiGet('/applications/' + skip + '/advancement/history')).at(-1).kind,
    'skip_evaluation'
  )
  evidence.push('skip evaluation requires explicit nonempty reason and real event')

  await detail(race)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'race editor')
  await input('晋级理由', '并发冲突保留草稿')
  // Concurrent HTTP operation after the UI preflight but before its command hits Command Core.
  raceAdvance = () => advance(race)
  await save()
  await check('!!document.querySelector(".v3-advance-conflict")', '409')
  await check(ed + '.textContent.includes("原阶段已变化")', 'no chained transition')
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"晋级理由\\"]").value'),
    '并发冲突保留草稿'
  )
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-advance-editor button")].find(b=>b.textContent.trim()==="确认保留理由并重新核验").disabled'
    )
  )
  await snapshot('advance-409')
  await button('返回', ed)
  assert.equal((await apiGet('/applications/' + race)).stage, 'second_interview')
  await check(editors + '===0', 'closed conflict')

  // Qualification changed BEFORE submission: no command is sent until explicit re-confirmation.
  await detail(race)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'fresh editor')
  await input('晋级理由', '版本更新后保持本次目标')
  const beforePatch = await apiGet('/applications/' + race)
  await apiPost(
    '/applications/' + race,
    { expectedVersion: beforePatch.version, note: '另一 HR 更新资料' },
    'PATCH'
  )
  const writes = browserWrites.length
  await save()
  await check('!!document.querySelector(".v3-advance-conflict")', 'pre-submit freshness')
  assert.equal(browserWrites.length, writes)
  await button('确认保留理由并重新核验', ed)
  await done()
  assert.equal((await apiGet('/applications/' + race)).stage, 'offer')
  evidence.push(
    'real HTTP 409 keeps draft and forbids next-stage chain; changed preflight requires new explicit confirmation'
  )

  const uncertainId = await create('未决晋级虚构申请')
  await detail(uncertainId)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'uncertain editor')
  deny = true
  await save()
  await check(ed + '.textContent.includes("登录状态仍有效")', 'operation403')
  failMe = true
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await check('document.body.innerText.includes("连接暂时中断")', 'identity unavailable')
  assert.ok(await evaluate('document.querySelector(".v3-advance-editor textarea").disabled'))
  failMe = false
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  const beforeDrop = count()
  drop = true
  await save()
  await check(ed + '.textContent.includes("本次操作结果尚未确认")', 'uncertain')
  await snapshot('advance-uncertain')
  await button('重试原晋级请求', ed)
  await done()
  assert.deepEqual(
    { ...count() },
    { events: beforeDrop.events + 1, receipts: beforeDrop.receipts + 1 }
  )
  assert.equal(browserWrites.at(-1).key, browserWrites.at(-2).key)
  assert.equal(browserWrites.at(-1).body, browserWrites.at(-2).body)
  assert.equal((await apiGet('/applications/' + uncertainId)).stage, 'first_interview')
  evidence.push(
    'operation403 retains identity; identity outage blocks writing; same key/body uncertain replay produces one event'
  )

  await detail(uncertainId)
  holdPath = '/api/v3/applications/' + uncertainId + '/advance/preflight'
  await button('核验并决定晋级', panel)
  await until(() => releaseHeld, 'held before unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  releaseHeld()
  releaseHeld = null
  await sleep(200)
  assert.equal(await evaluate(editors), 0)
  await detail(uncertainId)
  for (const kind of ['profile', 'interview']) {
    holdPath = '/api/v3/applications/' + uncertainId
    await button(
      kind === 'profile' ? '编辑申请资料' : '安排面试',
      kind === 'profile' ? 'document' : 'document.querySelector(".v3-interviews")'
    )
    await until(() => releaseHeld, 'held ' + kind)
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll(".v3-advancement button")].find(b=>b.textContent.trim()==="核验并决定晋级").disabled'
      )
    )
    releaseHeld()
    releaseHeld = null
    await check(editors + '===1', 'single ' + kind)
    await button(
      kind === 'profile' ? '取消' : '返回',
      kind === 'profile'
        ? 'document.querySelector(".v3-editor")'
        : 'document.querySelector(".v3-interview-editor")'
    )
    await check(editors + '===0', 'released ' + kind)
  }
  const fbMeeting = await book(uncertainId)
  await detail(uncertainId)
  holdPath = '/api/v3/applications/' + uncertainId + '/feedback'
  await button(
    '填写面评',
    'document.querySelector("[data-feedback-interview=\\"' + fbMeeting + '\\"]")'
  )
  await until(() => releaseHeld, 'held feedback')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-advancement button")].find(b=>b.textContent.trim()==="核验并决定晋级").disabled'
    )
  )
  releaseHeld()
  releaseHeld = null
  await check(editors + '===1', 'single feedback')
  await button('返回', 'document.querySelector(".v3-feedback-editor")')
  await check(editors + '===0', 'released feedback')
  evidence.push('four-editor shared lease with deterministic delayed opens and unmount')

  slowPreflight = true
  await button('刷新晋级资格', panel)
  await check('!!document.querySelector(".v3-advance-loading")', 'loading')
  await snapshot('advance-loading')
  assert.equal(await evaluate('document.querySelectorAll(".v3-advance-loading button").length'), 0)
  await check('!document.querySelector(".v3-advance-loading")', 'loading done')
  failPreflight = true
  await button('刷新晋级资格', panel)
  await check(panel + '.textContent.includes("暂时无法核验晋级资格")', 'preflight error')
  await snapshot('advance-error')
  failPreflight = false
  await button('重试晋级资格', panel)
  await check(panel + '.textContent.includes("核验并决定晋级")', 'retry')
  failHistory = true
  await button('刷新晋级历史', panel)
  await check(panel + '.textContent.includes("暂时无法查看晋级历史")', 'history fail')
  failHistory = false
  await button('重试晋级历史', panel)
  await check('!!document.querySelector("[data-advancement-event]")', 'history recover')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'))
  await snapshot('advance-mobile')
  await width(1440)
  evidence.push('structured loading, empty, separate error/retry, mobile390')

  const authBefore = count()
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'auth editor')
  await input('晋级理由', '账号切换保留边界')
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES(?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二虚构 HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('招聘工作台')
  await detail(uncertainId)
  assert.equal(await evaluate(editors), 0)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, 'revoked editor')
  await input('晋级理由', '撤权不应写入')
  db.prepare("UPDATE users SET role='viewer' WHERE username='second-hr'").run()
  await save()
  await h1('登录招聘工作台')
  assert.deepEqual(count(), authBefore)
  app.username = username
  await fill(app.password)
  await h1('招聘工作台')
  await detail(uncertainId)
  await button('核验并决定晋级', panel)
  await check('!!' + ed, '401 editor')
  unauthorized = true
  await save()
  await h1('登录招聘工作台')
  assert.equal(await evaluate(editors), 0)
  assert.equal(requests.filter((url) => /^\/api\/(?!v3\/)/.test(new URL(url).pathname)).length, 0)
  evidence.push(
    'account switch, revoked role and current-session 401 block old editors; zero V2 requests'
  )
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        pendingWriteEvidence: {
          httpWrites: 1,
          events: 1,
          receipts: 1,
          cancelLeaveRetainsEditor: true,
          successClearsDirty: true
        },
        passed: evidence.length,
        failed: 0,
        scenarios: evidence,
        v2Requests: 0,
        fixtures:
          'fresh V3 memory DB, actual advancement/feedback/closure HTTP; concurrent command injected by test wrapper before actual browser write',
        limitations: [
          '401 injected at HTTP boundary; real JWT validation covered by existing API tests',
          'formal AC and real-device acceptance not completed'
        ]
      },
      null,
      2
    )
  )
  console.log('PASS UI-04A ' + evidence.length + ' real Chromium scenario groups')
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
  Date.now = originalNow
}
