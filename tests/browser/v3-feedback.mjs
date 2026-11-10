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
  alignVersion = false,
  deny = false,
  drop = false,
  failMe = false,
  slowFeedback = false,
  failFeedback = false,
  failHistory = false
const browserWrites = [],
  errors = []
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
wrapped.use(express.json())
wrapped.use((req, res, next) => {
  if (req.method === 'GET' && req.path === holdPath) {
    holdPath = null
    releaseHeld = () => next()
    return
  }
  if (req.method === 'GET' && req.path.endsWith('/feedback') && slowFeedback) {
    slowFeedback = false
    return setTimeout(next, 2000)
  }
  if (req.method === 'GET' && req.path.endsWith('/feedback') && failFeedback)
    return res.status(503).json({ error: { code: 'FIXTURE_READ', message: 'fixture' } })
  if (
    req.method === 'GET' &&
    req.path.includes('/feedback/') &&
    req.path.endsWith('/history') &&
    failHistory
  )
    return res.status(503).json({ error: { code: 'FIXTURE_HISTORY', message: 'fixture' } })
  if (failMe && req.path === '/api/v3/auth/me')
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  const write = req.method === 'POST' && req.path.includes('/feedback')
  if (write) {
    browserWrites.push({ key: req.get('Idempotency-Key'), body: JSON.stringify(req.body) })
    if (alignVersion) {
      alignVersion = false
      req.body.expectedVersion = db
        .prepare('SELECT version FROM candidates WHERE id=?')
        .get(Number(req.path.split('/')[4])).version
    }
    if (deny) {
      deny = false
      return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
    }
    const original = res.json.bind(res)
    res.json = (body) => {
      if (body?.error) errors.push(body.error.code)
      if (drop && res.statusCode < 300) {
        drop = false
        res.socket.destroy()
        return res
      }
      return original(body)
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
    title: '虚构面评研究职位',
    department: '研发',
    location: '上海',
    description: '隔离面评验收',
    publishDate: '2030-01-01'
  })
  assert.equal(pos.status, 201)
  const positionId = pos.data.result.aggregateId
  const create = async (name) => {
    const r = await apiPost('/applications', {
      name,
      positionId,
      owner: '虚构业务负责人',
      appliedDate: '2030-01-01'
    })
    assert.equal(r.status, 201)
    return r.data.result.aggregateId
  }
  const advance = async (id) => {
    const a = await apiGet('/applications/' + id)
    assert.equal(
      (
        await apiPost('/applications/' + id + '/advance', {
          expectedVersion: a.version,
          reason: '隔离夹具真实缺评豁免'
        })
      ).status,
      200
    )
  }
  const book = async (id, complete = true) => {
    const a = await apiGet('/applications/' + id)
    const r = await apiPost('/applications/' + id + '/interviews', {
      expectedVersion: a.version,
      scheduledAt: '2030-01-01T14:00:00+08:00',
      interviewerName: '虚构面试官'
    })
    assert.equal(r.status, 201)
    const meeting = r.data.result.interviewId
    if (complete) {
      const now = await apiGet('/applications/' + id)
      assert.equal(
        (
          await apiPost('/applications/' + id + '/interviews/' + meeting + '/complete', {
            expectedVersion: now.version,
            interviewVersion: 1
          })
        ).status,
        200
      )
    }
    return meeting
  }
  const submitApi = async (id, meeting, body = {}) => {
    const a = await apiGet('/applications/' + id)
    return apiPost('/applications/' + id + '/interviews/' + meeting + '/feedback', {
      expectedVersion: a.version,
      reviewerName: '虚构专业评价人',
      recommendation: 'recommend',
      reason: '实际观察到的虚构表现',
      ...body
    })
  }
  const close = async (id) => {
    const a = await apiGet('/applications/' + id)
    assert.equal(
      (
        await apiPost('/applications/' + id + '/close', {
          expectedVersion: a.version,
          outcome: 'candidate_withdrew',
          reason: '虚构退出事实'
        })
      ).status,
      200
    )
  }
  const main = await create('当前轮次虚构申请')
  await advance(main)
  const meeting = await book(main)
  const pendingApp = await create('尚未完成虚构申请')
  await advance(pendingApp)
  const pendingMeeting = await book(pendingApp, false)
  const historical = await create('历史补录虚构申请')
  await advance(historical)
  const oldMeeting = await book(historical)
  await advance(historical)
  const closed = await create('关闭后更正虚构申请')
  await advance(closed)
  const closedMeeting = await book(closed)
  assert.equal((await submitApi(closed, closedMeeting)).status, 201)
  await close(closed)
  const closedMissing = await create('关闭且缺评虚构申请')
  await advance(closedMissing)
  const closedMissingMeeting = await book(closedMissing)
  await advance(closedMissing)
  await close(closedMissing)
  const empty = await create('无面试虚构申请')
  const noWaiver = await create('无豁免异常夹具')
  await advance(noWaiver)
  const noWaiverMeeting = await book(noWaiver)
  // Deliberately corrupt fixture preparation only, not a product operation or a legal advancement.
  db.prepare("UPDATE candidates SET stage='second_interview' WHERE id=?").run(noWaiver)
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
    const selector = JSON.stringify('[aria-label="' + label + '"]')
    await check('!!document.querySelector(' + selector + ')', 'input ' + label)
    await evaluate(
      '(()=>{const e=document.querySelector(' +
        selector +
        ');e.value=' +
        JSON.stringify(value) +
        ';e.dispatchEvent(new Event("input",{bubbles:true}))})()'
    )
  }
  const panel = 'document.querySelector(".v3-feedback-panel")'
  const card = (id) => 'document.querySelector("[data-feedback-interview=\\"' + id + '\\"]")'
  const ed = 'document.querySelector(".v3-feedback-editor")'
  const detailPage = async (id) => {
    await go('/candidates/' + id)
    await h1('申请详情')
    await check(
      '!!document.querySelector(".v3-feedback-panel")&&!document.querySelector(".v3-feedback-loading")',
      'feedback ready'
    )
  }
  const save = async () => {
    await check('!!' + ed, 'editor')
    await evaluate(ed + '.querySelector("form").requestSubmit()')
  }
  const choice = async (value) => {
    await click('[name="feedback-recommendation"][value="' + value + '"]')
  }
  const fillReview = async (text, recommendation = 'recommend') => {
    await input('专业评价人姓名', '陈老师（虚构）')
    await choice(recommendation)
    await input('推荐依据', text)
  }
  const done = async () => {
    await check('!document.querySelector(".v3-feedback-editor")', 'saved')
    await check(
      '!!document.querySelector(".v3-feedback-card")&&!document.querySelector(".v3-feedback-loading")',
      'refreshed'
    )
  }
  const count = () =>
    db
      .prepare(
        'SELECT (SELECT count(*) FROM feedback) AS feedback,(SELECT count(*) FROM business_events) AS events,(SELECT count(*) FROM command_receipts) AS receipts'
      )
      .get()
  const activeEditors =
    'document.querySelectorAll(".v3-feedback-editor,.v3-interview-editor,.v3-editor").length'
  await go('/candidates/' + main)
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('申请详情')
  await check('!!document.querySelector(".v3-feedback-card")', 'initial data')
  await detailPage(pendingApp)
  assert.equal(await evaluate(card(pendingMeeting) + '.querySelectorAll("button").length'), 0)
  assert.equal((await submitApi(pendingApp, pendingMeeting)).status, 409)
  evidence.push('scheduled interview cannot submit')
  await detailPage(empty)
  await check(panel + '.textContent.includes("暂无可关联的面试评价")', 'empty')
  await snapshot('feedback-empty')
  await detailPage(main)

  // Claim-before-read in both directions; held HTTP reads are released deterministically.
  holdPath = '/api/v3/applications/' + main + '/feedback'
  await button('填写面评', card(meeting))
  await until(() => releaseHeld, 'held feedback open')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="编辑申请资料").disabled'
    )
  )
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-interviews button")].find(e=>e.textContent.trim()==="安排面试").disabled'
    )
  )
  await button('刷新面试记录', 'document.querySelector(".v3-interviews")')
  releaseHeld()
  releaseHeld = null
  await check(activeEditors + '===1', 'single feedback editor')
  await button('返回', ed)
  await check(activeEditors + '===0', 'released feedback')
  holdPath = '/api/v3/applications/' + main
  await button('编辑申请资料')
  await until(() => releaseHeld, 'held profile open')
  assert.ok(await evaluate(card(meeting) + '.querySelector("button").disabled'))
  releaseHeld()
  releaseHeld = null
  await check('!!document.querySelector(".v3-editor")', 'profile open')
  await button('取消', 'document.querySelector(".v3-editor")')
  await check(activeEditors + '===0', 'profile closed')
  holdPath = '/api/v3/applications/' + main
  await button('安排面试', 'document.querySelector(".v3-interviews")')
  await until(() => releaseHeld, 'held interview open')
  assert.ok(await evaluate(card(meeting) + '.querySelector("button").disabled'))
  releaseHeld()
  releaseHeld = null
  await check(activeEditors + '===1', 'single interview editor')
  await button('返回', 'document.querySelector(".v3-interview-editor")')
  await check(activeEditors + '===0', 'interview closed')
  await button('填写面评', card(meeting))
  await fillReview('基础能力良好，能解释组件边界。')
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await sleep(300)
  assert.equal(await evaluate(activeEditors), 1)
  dialogMode = true
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  await detailPage(main)
  holdPath = '/api/v3/applications/' + main + '/feedback'
  await button('填写面评', card(meeting))
  await until(() => releaseHeld, 'pending feedback before unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  releaseHeld()
  releaseHeld = null
  await sleep(300)
  assert.equal(await evaluate(activeEditors), 0)
  evidence.push(
    'shared editor lease, both profile/interview directions, draft leave and late unmount'
  )

  await detailPage(main)
  await button('填写面评', card(meeting))
  await fillReview('基础能力良好，能解释组件边界。')
  const invalidBefore = count()
  await input('专业评价人姓名', '   ')
  await save()
  await check(ed + '.textContent.includes("请填写专业评价人")', 'blank reviewer rejected')
  assert.deepEqual(count(), invalidBefore)
  await input('专业评价人姓名', '陈老师（虚构）')
  await snapshot('feedback-submit')
  deny = true
  await save()
  await check(ed + '.textContent.includes("登录状态仍有效")', 'operation403')
  failMe = true
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await check('document.body.innerText.includes("连接暂时中断")', 'identity outage')
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"推荐依据\\"]").value'),
    '基础能力良好，能解释组件边界。'
  )
  assert.ok(await evaluate(ed + '.querySelector("fieldset").disabled'))
  failMe = false
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  const before = count()
  drop = true
  await save()
  await check(ed + '.textContent.includes("提交结果尚未确定")', 'uncertain')
  assert.ok(await evaluate(ed + '.querySelector("fieldset").disabled'))
  await snapshot('feedback-uncertain')
  assert.equal(count().feedback, before.feedback + 1)
  await button('重试原请求', ed)
  await done()
  assert.equal(count().feedback, before.feedback + 1)
  assert.equal(count().events, before.events + 1)
  assert.equal(count().receipts, before.receipts + 1)
  assert.equal(browserWrites.at(-1).key, browserWrites.at(-2).key)
  assert.equal(browserWrites.at(-1).body, browserWrites.at(-2).body)
  const currentRecord = (await apiGet('/applications/' + main + '/feedback'))[0]
  assert.equal(currentRecord.recommendation, 'recommend')
  assert.equal(currentRecord.recordedByUserId, 1)
  assert.notEqual(currentRecord.reviewerName, '本地演示 HR')
  assert.equal((await apiGet('/applications/' + main)).stage, 'first_interview')
  const dupBefore = count()
  assert.equal((await submitApi(main, meeting)).status, 409)
  assert.deepEqual(count(), dupBefore)
  await snapshot('feedback-current')
  evidence.push(
    'first submit recommend, distinct reviewer/HR, no advancement, duplicate rejected, same-key uncertain replay, operation403 and identity outage'
  )

  await button('更正面评', card(meeting))
  await check('!!' + ed, 'correction open')
  await snapshot('feedback-correction')
  const invalidCorrection = count()
  await input('更正原因', '   ')
  await save()
  await check(ed + '.textContent.includes("更正必须填写原因")', 'blank correction reason')
  assert.deepEqual(count(), invalidCorrection)
  await input('更正原因', '补全专业评价原始描述')
  const noChange = count()
  await save()
  await check(ed + '.textContent.includes("内容没有变化")', 'no change')
  assert.deepEqual(count(), noChange)
  await choice('not_recommend')
  await input('推荐依据', '需补充复杂场景的论证。')
  await input('更正原因', '核对原始记录后纠正结论')
  await save()
  await done()
  const revised = (await apiGet('/applications/' + main + '/feedback'))[0]
  assert.equal(revised.id, currentRecord.id)
  assert.equal(revised.submittedAt, currentRecord.submittedAt)
  assert.equal(revised.recordedByUserId, currentRecord.recordedByUserId)
  assert.equal(revised.recommendation, 'not_recommend')
  await button('查看面评历史', card(meeting))
  await check('document.querySelectorAll("[data-feedback-event]").length===2', 'real history')
  await snapshot('feedback-history')
  evidence.push(
    'correction reason, NO_CHANGE no effects, original ID/time/HR, complete real history snapshots'
  )

  // Real concurrent HR changes cause independent aggregate and feedback-revision conflicts.
  const correctApi = async (text) => {
    const a = await apiGet('/applications/' + main)
    const f = (await apiGet('/applications/' + main + '/feedback'))[0]
    assert.equal(
      (
        await apiPost('/applications/' + main + '/interviews/' + meeting + '/feedback/correct', {
          expectedVersion: a.version,
          feedbackRevision: f.revision,
          reviewerName: '第二位专业评价人（虚构）',
          recommendation: 'undecided',
          reason: text,
          correctionReason: '其他 HR 核对原始记录'
        })
      ).status,
      200
    )
  }
  for (const revisionOnly of [false, true]) {
    await button('更正面评', card(meeting))
    await input('推荐依据', revisionOnly ? '保留修订冲突草稿' : '保留申请版本冲突草稿')
    await input('更正原因', '我的独立核对')
    await correctApi(revisionOnly ? '并发评价修订事实' : '并发申请聚合事实')
    alignVersion = revisionOnly
    const c = count()
    await save()
    await check('!!document.querySelector(".v3-feedback-conflict")', 'conflict')
    await check(
      '!!document.querySelector(".v3-feedback-conflict .v3-feedback-snapshot")',
      'latest feedback'
    )
    assert.equal(errors.at(-1), revisionOnly ? 'FEEDBACK_REVISION_CONFLICT' : 'VERSION_CONFLICT')
    assert.deepEqual(count(), c)
    assert.equal(
      await evaluate('document.querySelector("[aria-label=\\"推荐依据\\"]").value'),
      revisionOnly ? '保留修订冲突草稿' : '保留申请版本冲突草稿'
    )
    await snapshot(revisionOnly ? 'feedback-revision-conflict' : 'feedback-409')
    dialogMode = false
    await button('确认按新版本重新提交', ed)
    await sleep(200)
    assert.deepEqual(count(), c)
    dialogMode = true
    await button('确认按新版本重新提交', ed)
    await done()
    assert.equal(count().events, c.events + 1)
  }
  evidence.push(
    'real aggregate VERSION_CONFLICT and feedback FEEDBACK_REVISION_CONFLICT, draft and latest history, explicit cancel/confirm'
  )

  await detailPage(noWaiver)
  assert.ok(await evaluate(card(noWaiverMeeting) + '.textContent.includes("没有真实晋级豁免证据")'))
  assert.equal(await evaluate(card(noWaiverMeeting) + '.querySelectorAll("button").length'), 0)
  await detailPage(closedMissing)
  assert.ok(await evaluate(card(closedMissingMeeting) + '.textContent.includes("历史缺评")'))
  assert.equal(await evaluate(card(closedMissingMeeting) + '.querySelectorAll("button").length'), 0)
  const closedFacts = await apiGet('/applications/' + closedMissing)
  const rejected = await apiPost(
    '/applications/' +
      closedMissing +
      '/interviews/' +
      closedMissingMeeting +
      '/feedback/supplement',
    {
      expectedVersion: closedFacts.version,
      reviewerName: '虚构评价人',
      recommendation: 'recommend',
      reason: '不应新增'
    }
  )
  assert.equal(rejected.status, 409)
  await detailPage(historical)
  await check(card(oldMeeting) + '.textContent.includes("历史缺评")', 'waiver shown')
  await snapshot('feedback-historical-missing')
  const waiver = db
    .prepare(
      "SELECT * FROM business_events WHERE candidate_id=? AND event_type='stage_advanced' ORDER BY id DESC LIMIT 1"
    )
    .get(historical)
  await button('补录历史面评', card(oldMeeting))
  await fillReview('按原面试记录补充，保留真实补录时间。', 'undecided')
  fixtureNow += 86400000
  await save()
  await done()
  assert.equal((await apiGet('/applications/' + historical)).stage, 'second_interview')
  assert.deepEqual(db.prepare('SELECT * FROM business_events WHERE id=?').get(waiver.id), waiver)
  const supplemented = (await apiGet('/applications/' + historical + '/feedback'))[0]
  assert.equal(supplemented.recommendation, 'undecided')
  assert.equal(supplemented.submittedAt, fixtureNow)
  await check(card(oldMeeting) + '.textContent.includes("晋级后补录")', 'supplement mark')
  await snapshot('feedback-supplemented')
  await button('查看面评历史', card(oldMeeting))
  await check('!!document.querySelector("[data-feedback-event]")', 'supplement history')
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-feedback-history").textContent.includes("关联原晋级豁免事件 #' +
        waiver.id +
        '")'
    )
  )
  evidence.push(
    'no waiver denied; real waiver active historical supplement; unchanged original waiver; actual supplement time; closed missing denied'
  )

  await detailPage(closed)
  const closedBefore = await apiGet('/applications/' + closed)
  const originalClosed = (await apiGet('/applications/' + closed + '/feedback'))[0]
  await button('更正面评', card(closedMeeting))
  await input('推荐依据', '关闭后核对事实，更正误录。')
  await input('更正原因', '原始文字录入遗漏')
  const correctionCount = count()
  drop = true
  await save()
  await check(ed + '.textContent.includes("提交结果尚未确定")', 'uncertain correction')
  assert.equal(count().events, correctionCount.events + 1)
  await button('重试原请求', ed)
  await done()
  assert.equal(count().events, correctionCount.events + 1)
  assert.equal(count().receipts, correctionCount.receipts + 1)
  assert.equal(count().feedback, correctionCount.feedback)
  assert.equal(browserWrites.at(-1).key, browserWrites.at(-2).key)
  assert.equal(browserWrites.at(-1).body, browserWrites.at(-2).body)
  const closedAfter = await apiGet('/applications/' + closed)
  for (const field of ['stage', 'applicationStatus', 'outcome', 'offerStatus'])
    assert.equal(closedAfter[field], closedBefore[field])
  const finalClosed = (await apiGet('/applications/' + closed + '/feedback'))[0]
  assert.equal(finalClosed.id, originalClosed.id)
  assert.equal(finalClosed.submittedAt, originalClosed.submittedAt)
  await button('查看面评历史', card(closedMeeting))
  await check(
    'document.querySelector(".v3-feedback-history")?.textContent.includes("该更正发生在原招聘决策之后")',
    'attested prior closure'
  )
  await snapshot('feedback-closed-correction')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'))
  await snapshot('feedback-mobile')
  await width(1440)
  evidence.push(
    'closed existing correction preserves lifecycle, evidence-based post-decision notice, mobile390'
  )

  slowFeedback = true
  await button('刷新面评', panel)
  await check('!!document.querySelector(".v3-feedback-loading")', 'loading structure')
  assert.ok(
    await evaluate(
      'document.querySelector(".v3-feedback-loading").getAttribute("aria-busy")==="true"'
    )
  )
  assert.equal(
    await evaluate('document.querySelectorAll(".v3-feedback-loading article").length'),
    3
  )
  assert.equal(await evaluate('document.querySelectorAll(".v3-feedback-card").length'), 0)
  await snapshot('feedback-loading')
  await check('!document.querySelector(".v3-feedback-loading")', 'loaded')
  failFeedback = true
  await button('刷新面评', panel)
  await check(panel + '.textContent.includes("暂时无法查看面评")', 'error')
  await snapshot('feedback-error')
  failFeedback = false
  await button('重新加载', panel)
  await check('!!document.querySelector(".v3-feedback-card")', 'retry')
  await button('查看面评历史', card(closedMeeting))
  await check('!!document.querySelector(".v3-feedback-history")', 'history loaded')
  failHistory = true
  await button('查看面评历史', card(closedMeeting))
  await check(panel + '.textContent.includes("暂时无法查看历史")', 'history error')
  failHistory = false
  await button('重试历史', panel)
  await check('!!document.querySelector(".v3-feedback-history")', 'history retry')
  evidence.push(
    'loading keeps structure no stale operations, true empty, errors/retry for feedback and history'
  )

  await button('更正面评', card(closedMeeting))
  await input('推荐依据', '不得串入其他账号的草稿')
  await input('更正原因', '账号边界验证')
  const accountBefore = count()
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二位演示 HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('招聘工作台')
  await detailPage(closed)
  assert.equal(await evaluate(activeEditors), 0)
  assert.deepEqual(count(), accountBefore)
  // Current session revocation is checked against the real in-memory user row.
  await button('更正面评', card(closedMeeting))
  await input('推荐依据', '撤权后不得写入')
  await input('更正原因', '撤权验证')
  db.prepare("UPDATE users SET role='viewer' WHERE username='second-hr'").run()
  await save()
  await h1('登录招聘工作台')
  assert.deepEqual(count(), accountBefore)
  assert.equal(requests.filter((url) => /^\/api\/(?!v3\/)/.test(new URL(url).pathname)).length, 0)
  evidence.push('account switch and role revocation discard old ownership; zero V2 requests')
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        fixtures:
          'fresh V3 memory DB; real advancement/waiver/closure HTTP; no-waiver row is deliberately inconsistent fixture only',
        scenarios: evidence,
        passed: evidence.length,
        failed: 0,
        v2Requests: 0,
        revisionConflictFixture:
          'only expectedVersion aligned in test wrapper after real concurrent correction to independently exercise feedbackRevision rejection',
        uncertainReplay: 'same key and byte-identical body, one feedback/event/receipt',
        limitations: [
          'no real device or production data',
          'no HR advancement UI or Dashboard UI',
          'formal AC suite not completed'
        ]
      },
      null,
      2
    )
  )
  console.log('PASS UI-03B ' + evidence.length + ' grouped real Chromium scenarios')
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
  Date.now = originalNow
}
