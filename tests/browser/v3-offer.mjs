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
  releaseResponse = null,
  holdPath = null,
  releaseHeld = null,
  unauthorized = false,
  deny = false,
  drop = false,
  failMe = false,
  failRead = false,
  slowRead = false,
  failHistory = false,
  raceAction = null
const dialogs = [],
  browserWrites = []
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
wrapped.use(express.json())
wrapped.use(async (req, res, next) => {
  if (req.method === 'GET' && req.path === holdPath) {
    holdPath = null
    releaseHeld = () => next()
    return
  }
  if (req.method === 'GET' && req.path.endsWith('/offer/preflight')) {
    if (unauthorized)
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'fixture' } })
    if (failRead) return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
    if (slowRead) {
      slowRead = false
      return setTimeout(next, 2000)
    }
  }
  if (req.path.endsWith('/offer/history') && failHistory)
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (req.path === '/api/v3/auth/me' && failMe)
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (req.method === 'POST' && (/\/offer\//.test(req.path) || req.path.endsWith('/close'))) {
    browserWrites.push({
      path: req.path,
      key: req.get('Idempotency-Key'),
      body: JSON.stringify(req.body)
    })
    if (deny) {
      deny = false
      return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
    }
    if (raceAction) {
      const action = raceAction
      raceAction = null
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
    title: '虚构 Offer 职位',
    department: '研发',
    location: '上海',
    publishDate: '2030-01-01',
    description: '隔离验收'
  })
  const positionId = pos.data.result.aggregateId
  const create = async (name, stage = 'offer') => {
    const r = await apiPost('/applications', {
      name,
      positionId,
      owner: '虚构负责人',
      appliedDate: '2030-01-01'
    })
    assert.equal(r.status, 201)
    const id = r.data.result.aggregateId
    for (
      let i = 0;
      i < ['screening', 'first_interview', 'second_interview', 'offer'].indexOf(stage);
      i++
    ) {
      const p = await apiGet('/applications/' + id + '/advance/preflight')
      assert.equal(
        (
          await apiPost('/applications/' + id + '/advance', {
            expectedVersion: p.version,
            targetStage: p.toStage,
            reason: '真实夹具跳过评估'
          })
        ).status,
        200
      )
    }
    return id
  }
  const perform = async (id, action, body = {}) => {
    const a = await apiGet('/applications/' + id)
    return apiPost('/applications/' + id + (action === 'close' ? '/close' : '/offer/' + action), {
      expectedVersion: a.version,
      ...body
    })
  }
  const main = await create('Offer 主流程虚构申请'),
    reject = await create('拒绝虚构申请'),
    race = await create('并发虚构申请')
  const appointmentId = await create('有预约虚构申请', 'first_interview')
  const pa = await apiGet('/applications/' + appointmentId)
  const meeting = (
    await apiPost('/applications/' + appointmentId + '/interviews', {
      expectedVersion: pa.version,
      scheduledAt: '2030-01-01T14:00:00+08:00',
      interviewerName: '虚构面试官'
    })
  ).data.result.interviewId
  // Explicit extreme fixture only: preserve a scheduled interview while assigning valid Offer state.
  // Legal advancement forbids this; it is necessary to independently test send/accept versus closure guards.
  db.prepare("UPDATE candidates SET stage='offer',offer_status='preparing' WHERE id=?").run(
    appointmentId
  )
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
  const input = async (label, value) =>
    evaluate(
      '(()=>{const e=document.querySelector(' +
        JSON.stringify('[aria-label="' + label + '"]') +
        ');e.value=' +
        JSON.stringify(value) +
        ';e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()'
    )
  const panel = 'document.querySelector(".v3-offer")',
    ed = 'document.querySelector(".v3-offer-editor")'
  const detail = async (id) => {
    await go('/candidates/' + id)
    await h1('申请详情')
    await check(
      '!!document.querySelector(".v3-offer")&&!document.querySelector(".v3-offer-loading")',
      'offer ready'
    )
  }
  const open = async (text) => {
    await button(text, panel)
    await check('!!' + ed, 'offer editor')
  }
  const save = () => evaluate(ed + '.querySelector("form").requestSubmit()')
  const done = async () => {
    await check('!document.querySelector(".v3-offer-editor")', 'saved')
    await check(
      '!!document.querySelector(".v3-offer")&&!document.querySelector(".v3-offer-loading")',
      'refreshed'
    )
  }
  const count = () => ({
    ...db
      .prepare(
        'SELECT (SELECT count(*) FROM business_events) events,(SELECT count(*) FROM command_receipts) receipts'
      )
      .get()
  })
  const editorCount =
    'document.querySelectorAll(".v3-offer-editor,.v3-advance-editor,.v3-feedback-editor,.v3-interview-editor,.v3-editor").length'
  await go('/candidates/' + main)
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('申请详情')
  await check(panel + '.textContent.includes("准备中")', 'preparing')
  await snapshot('offer-preparing')
  assert.equal((await apiGet('/applications/' + main)).offerStatus, 'preparing')
  assert.equal((await perform(main, 'accept')).status, 409)
  assert.equal((await perform(main, 'confirm-hire')).status, 409)
  assert.equal((await perform(main, 'decline', { reason: '非法' })).status, 409)
  await check(panel + '.textContent.includes("暂无 Offer 或结案事件")', 'empty')
  await snapshot('offer-empty')
  const confirmationEvidence = {}
  dialogMode = false
  await open('登记 Offer 已发送')
  const cancelBefore = count(),
    cancelWrites = browserWrites.length,
    cancelDialogs = dialogs.length
  await save()
  await until(() => dialogs.length > cancelDialogs, 'cancel actual send confirmation')
  assert.match(dialogs.at(-1), /登记 Offer 已发送/)
  assert.doesNotMatch(dialogs.at(-1), /结束招聘|已录用/)
  await check(
    '!document.querySelector(".v3-offer-editor button.is-loading")',
    'cancelled confirmation settled'
  )
  assert.deepEqual(count(), cancelBefore)
  assert.equal(browserWrites.length, cancelWrites)
  confirmationEvidence.send = dialogs.at(-1)
  dialogMode = true
  const before = count(),
    writes = browserWrites.length
  holdResponse = true
  await Promise.all([save(), save()])
  await until(() => releaseResponse, 'held empty-reason write')
  const n = dialogs.length
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await until(() => dialogs.length > n, 'leave warning')
  assert.match(dialogs.at(-1), /服务器可能已保存/)
  assert.equal(await evaluate(editorCount), 1)
  assert.equal(browserWrites.length, writes + 1)
  await snapshot('offer-pending-leave')
  releaseResponse()
  releaseResponse = null
  await done()
  assert.deepEqual(count(), { events: before.events + 1, receipts: before.receipts + 1 })
  assert.deepEqual(
    await evaluate(
      'import("/src/router/v3-drafts.ts").then(m=>({dirty:m.v3DraftDirty.value,uncertain:m.v3UncertainWrite.value}))'
    ),
    { dirty: false, uncertain: false }
  )
  await snapshot('offer-sent')
  assert.equal((await perform(main, 'confirm-hire')).status, 409)
  dialogMode = true
  await open('登记候选人接受 Offer')
  await save()
  await done()
  assert.match(dialogs.at(-1), /登记候选人接受 Offer/)
  assert.match(dialogs.at(-1), /仍为进行中.*HR 后续独立确认录用/)
  assert.doesNotMatch(dialogs.at(-1), /结束招聘/)
  confirmationEvidence.accept = dialogs.at(-1)
  const accepted = await apiGet('/applications/' + main)
  assert.equal(accepted.offerStatus, 'accepted')
  assert.equal(accepted.applicationStatus, 'active')
  assert.equal(accepted.outcome, null)
  await snapshot('offer-accepted-not-hired')
  await open('HR 确认录用')
  await snapshot('offer-hire-confirm')
  holdResponse = true
  await save()
  await until(() => releaseResponse, 'held empty-reason hiring response')
  assert.match(dialogs.at(-1), /HR 正式确认录用.*招聘申请将结束.*结果为已录用/)
  confirmationEvidence.confirmHire = dialogs.at(-1)
  assert.ok(
    await evaluate(
      'import("/src/router/v3-drafts.ts").then(m=>m.v3DraftDirty.value&&m.v3UncertainWrite.value)'
    )
  )
  releaseResponse()
  releaseResponse = null
  await done()
  const hired = await apiGet('/applications/' + main)
  assert.equal(hired.offerStatus, 'accepted')
  assert.equal(hired.outcome, 'hired')
  assert.equal(hired.applicationStatus, 'closed')
  assert.equal(hired.closedReason, 'HR 确认录用')
  await check(panel + '.textContent.includes("服务器默认原因")', 'default source')
  await snapshot('offer-hired-history')
  assert.equal(
    (await apiGet('/applications/' + main + '/offer/history')).at(-1).reasonSource,
    'system_default'
  )
  evidence.push(
    'preparing→sent→accepted stays active→explicit hired, default reason source; empty-reason pending leave and exactly-once'
  )
  for (const a of ['send', 'accept', 'decline', 'confirm-hire', 'close'])
    assert.equal(
      (
        await perform(main, a, {
          ...(['send', 'accept'].includes(a) ? {} : { reason: '再次结束' }),
          ...(a === 'close' ? { outcome: 'company_rejected' } : {})
        })
      ).status,
      409
    )
  await detail(reject)
  await open('登记 Offer 已发送')
  await save()
  await done()
  await open('登记候选人拒绝 Offer')
  await save()
  await check(ed + '.textContent.includes("非空结束原因")', 'decline reason')
  await input('结束原因', '候选人明确拒绝（虚构）')
  dialogMode = false
  const cancelledDecline = count(),
    declineWrites = browserWrites.length,
    declineDialogs = dialogs.length
  await save()
  await until(() => dialogs.length > declineDialogs, 'decline confirmation cancellation')
  assert.match(dialogs.at(-1), /登记候选人拒绝 Offer，并结束本次招聘申请/)
  assert.ok(dialogs.at(-1).includes('申请 #' + reject))
  assert.match(dialogs.at(-1), /候选人明确拒绝（虚构）/)
  confirmationEvidence.decline = dialogs.at(-1)
  await check(
    '!document.querySelector(".v3-offer-editor button.is-loading")',
    'decline cancellation settled'
  )
  assert.deepEqual(count(), cancelledDecline)
  assert.equal(browserWrites.length, declineWrites)
  dialogMode = true
  const declinedBefore = count(),
    closedRequests = browserWrites.filter((w) => w.path.endsWith('/close')).length
  await save()
  await done()
  const declined = await apiGet('/applications/' + reject)
  assert.deepEqual(
    [declined.offerStatus, declined.applicationStatus, declined.outcome],
    ['declined', 'closed', 'offer_declined']
  )
  assert.equal(count().events, declinedBefore.events + 1)
  assert.equal(browserWrites.filter((w) => w.path.endsWith('/close')).length, closedRequests)
  await snapshot('offer-declined')
  evidence.push(
    'decline requires reason and atomically closes via one dedicated command; closed operations rejected'
  )

  const matrix = []
  for (const stage of ['screening', 'first_interview', 'second_interview', 'offer']) {
    for (const outcome of ['company_rejected', 'candidate_withdrew']) {
      const id = await create('普通结案虚构 ' + stage + ' ' + outcome, stage)
      await detail(id)
      await open('结束招聘')
      await save()
      await check(ed + '.textContent.includes("非空结束原因")', 'closure requires reason')
      await input('结束原因', '真实业务原因（虚构）')
      await save()
      await check(ed + '.textContent.includes("明确选择")', 'no default outcome')
      await input('结束类型', outcome)
      await save()
      await done()
      const a = await apiGet('/applications/' + id)
      assert.match(dialogs.at(-1), /结束当前申请/)
      assert.ok(dialogs.at(-1).includes(outcome === 'company_rejected' ? '企业淘汰' : '候选人退出'))
      confirmationEvidence[outcome] = dialogs.at(-1)
      assert.equal(a.stage, stage)
      assert.equal(a.outcome, outcome)
      assert.equal(a.offerStatus, stage === 'offer' ? 'preparing' : null)
      matrix.push(stage + '/' + outcome)
      if (stage === 'first_interview' && outcome === 'company_rejected')
        await snapshot('closure-first-interview')
    }
  }
  for (const status of ['sent', 'accepted']) {
    const id = await create('保留 Offer ' + status)
    await perform(id, 'send')
    if (status === 'accepted') await perform(id, 'accept')
    await detail(id)
    await open('结束招聘')
    await input('结束类型', 'candidate_withdrew')
    await input('结束原因', '候选人按实际情况退出')
    await save()
    await done()
    assert.equal((await apiGet('/applications/' + id)).offerStatus, status)
    matrix.push('offer/' + status + '/candidate_withdrew')
  }
  const invalid = await create('非法结果虚构申请', 'screening')
  for (const outcome of ['hired', 'offer_declined'])
    assert.equal((await perform(invalid, 'close', { outcome, reason: '非法尝试' })).status, 422)
  assert.equal((await perform(invalid, 'send')).status, 409)
  evidence.push(
    'four stages × both explicit outcomes; Offer preparing/sent/accepted preserved; invalid close outcomes rejected'
  )
  await detail(appointmentId)
  await check(panel + '.textContent.includes("面试 #' + meeting + '")', 'appointmentId fact')
  await snapshot('offer-scheduled-block')
  assert.equal((await perform(appointmentId, 'send')).status, 200)
  assert.equal((await perform(appointmentId, 'accept')).status, 200)
  for (const action of ['close', 'confirm-hire'])
    assert.equal(
      (
        await perform(appointmentId, action, {
          reason: '无法绕过',
          ...(action === 'close' ? { outcome: 'candidate_withdrew' } : {})
        })
      ).status,
      409
    )
  // Decline guard independently exercised in the same isolated extreme fixture.
  const pv = await apiGet('/applications/' + appointmentId)
  db.prepare("UPDATE candidates SET offer_status='sent' WHERE id=?").run(appointmentId)
  assert.equal((await perform(appointmentId, 'decline', { reason: '仍有预约' })).status, 409)
  assert.equal(pv.applicationStatus, 'active')
  evidence.push(
    'scheduled blocks close/decline/hire; send/accept allowed by own server policy; extreme fixture explicitly marked'
  )

  await detail(race)
  await open('登记 Offer 已发送')
  raceAction = () => perform(race, 'send')
  await save()
  await check('!!document.querySelector(".v3-offer-editor section")', 'conflict')
  await check(ed + '.textContent.includes("原操作前提已变化")', 'old premise blocked')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll(".v3-offer-editor button")].find(b=>b.textContent.trim()==="确认原意图并重新核验").disabled'
    )
  )
  await snapshot('offer-409')
  await button('返回', ed)
  await check(editorCount + '===0', 'closed')
  assert.equal((await apiGet('/applications/' + race)).offerStatus, 'sent')
  await detail(race)
  await open('登记候选人接受 Offer')
  deny = true
  await save()
  await check(ed + '.textContent.includes("登录状态仍有效")', '403')
  failMe = true
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await check('document.body.innerText.includes("连接暂时中断")', 'outage')
  failMe = false
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  const replayCount = count()
  drop = true
  await save()
  await check(ed + '.textContent.includes("结果尚未确定")', 'unknown')
  await snapshot('offer-uncertain')
  await button('重试原操作', ed)
  await done()
  assert.deepEqual(count(), { events: replayCount.events + 1, receipts: replayCount.receipts + 1 })
  assert.equal(browserWrites.at(-1).key, browserWrites.at(-2).key)
  assert.equal(browserWrites.at(-1).body, browserWrites.at(-2).body)
  assert.equal(browserWrites.at(-1).path, browserWrites.at(-2).path)
  assert.equal((await apiGet('/applications/' + race)).applicationStatus, 'active')
  evidence.push(
    '409 cannot reinterpret send as accept; operation403/outage; unknown accept repeats exact intent once'
  )

  const mutex = await create('编辑器互斥虚构申请', 'first_interview')
  const ma = await apiGet('/applications/' + mutex)
  const mi = (
    await apiPost('/applications/' + mutex + '/interviews', {
      expectedVersion: ma.version,
      scheduledAt: '2030-01-01T14:00:00+08:00',
      interviewerName: '虚构专家'
    })
  ).data.result.interviewId
  await apiPost('/applications/' + mutex + '/interviews/' + mi + '/complete', {
    expectedVersion: ma.version + 1,
    interviewVersion: 1
  })
  await detail(mutex)
  holdPath = '/api/v3/applications/' + mutex + '/offer/preflight'
  await button('结束招聘', panel)
  await until(() => releaseHeld, 'lease before async')
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="编辑申请资料").disabled'
    )
  )
  for (const scope of ['.v3-advancement', '.v3-interviews', '.v3-feedback-card'])
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll(' +
          JSON.stringify(scope + ' button') +
          ')].every(b=>b.disabled||b.textContent.trim().startsWith("刷新"))'
      )
    )
  releaseHeld()
  releaseHeld = null
  await check(editorCount + '===1', 'exclusive')
  await input('结束原因', '未保存的结案理由')
  dialogMode = false
  await click('.v3-sidebar a[href="/positions"]')
  await sleep(150)
  assert.equal(await evaluate(editorCount), 1)
  dialogMode = true
  await button('返回', ed)
  await check(editorCount + '===0', 'released')
  for (const kind of ['profile', 'interview', 'feedback', 'advance']) {
    const text = {
      profile: '编辑申请资料',
      interview: '安排面试',
      feedback: '填写面评',
      advance: '核验并决定晋级'
    }[kind]
    const scope = {
      profile: 'document',
      interview: 'document.querySelector(".v3-interviews")',
      feedback: 'document.querySelector(".v3-feedback-card")',
      advance: 'document.querySelector(".v3-advancement")'
    }[kind]
    holdPath = '/api/v3/applications/' + mutex
    await button(text, scope)
    await until(() => releaseHeld, 'other lease ' + kind)
    assert.ok(
      await evaluate(
        '[...document.querySelectorAll(".v3-offer button")].find(b=>b.textContent.trim()==="结束招聘").disabled'
      )
    )
    releaseHeld()
    releaseHeld = null
    await check(editorCount + '===1', 'single ' + kind)
    await button(
      kind === 'profile' ? '取消' : '返回',
      kind === 'profile'
        ? 'document.querySelector(".v3-editor")'
        : kind === 'interview'
          ? 'document.querySelector(".v3-interview-editor")'
          : kind === 'feedback'
            ? 'document.querySelector(".v3-feedback-editor")'
            : 'document.querySelector(".v3-advance-editor")'
    )
    await check(editorCount + '===0', 'closed ' + kind)
  }
  holdPath = '/api/v3/applications/' + mutex + '/offer/preflight'
  await button('结束招聘', panel)
  await until(() => releaseHeld, 'appointmentId unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  releaseHeld()
  releaseHeld = null
  await sleep(100)
  assert.equal(await evaluate(editorCount), 0)
  evidence.push('five-editor async mutex both directions, draft confirmation, late unmount ignored')

  await detail(mutex)
  slowRead = true
  await button('刷新 Offer 状态', panel)
  await check('!!document.querySelector(".v3-offer-loading")', 'loading')
  await snapshot('offer-loading')
  await check('!document.querySelector(".v3-offer-loading")', 'loaded')
  failRead = true
  await button('刷新 Offer 状态', panel)
  await check(panel + '.textContent.includes("暂时无法查看 Offer")', 'error')
  await snapshot('offer-error')
  failRead = false
  await button('重试 Offer 状态', panel)
  await check(panel + '.textContent.includes("结束招聘")', 'retry')
  failHistory = true
  await button('刷新 Offer 历史', panel)
  await check(panel + '.textContent.includes("暂时无法查看 Offer 历史")', 'history error')
  failHistory = false
  await button('重试 Offer 历史', panel)
  await check(panel + '.textContent.includes("暂无 Offer 或结案事件")', 'history empty')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=390'))
  await snapshot('offer-mobile')
  await width(1440)
  evidence.push('structured loading, true empty, separate errors/retry, mobile390')
  await open('结束招聘')
  await input('结束原因', '身份切换草稿')
  const authBefore = count()
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES(?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二虚构 HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('招聘工作台')
  await detail(mutex)
  assert.equal(await evaluate(editorCount), 0)
  await open('结束招聘')
  db.prepare("UPDATE users SET role='viewer' WHERE username='second-hr'").run()
  await input('结束类型', 'candidate_withdrew')
  await input('结束原因', '撤权不应保存')
  await save()
  await h1('登录招聘工作台')
  assert.deepEqual(count(), authBefore)
  app.username = username
  await fill(app.password)
  await h1('招聘工作台')
  await detail(mutex)
  await open('结束招聘')
  unauthorized = true
  await save()
  await h1('登录招聘工作台')
  assert.deepEqual(count(), authBefore)
  assert.equal(requests.filter((url) => /^\/api\/(?!v3\/)/.test(new URL(url).pathname)).length, 0)
  evidence.push('account isolation, actual role withdrawal, HTTP401 and zero V2 requests')
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        confirmationEvidence,
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        passed: evidence.length,
        failed: 0,
        scenarios: evidence,
        matrix,
        v2Requests: 0,
        pendingWrite: { writes: 1, events: 1, receipts: 1 },
        fixtures: [
          'fresh in-memory SQLite, real HTTP commands',
          'scheduled+Offer extreme fixture uses explicit direct state preparation; does not represent legal advancement'
        ],
        limitations: [
          'real devices and formal full AC not completed',
          '401 injected at HTTP boundary, JWT authenticity covered by API tests'
        ]
      },
      null,
      2
    )
  )
  console.log('PASS UI-04B ' + evidence.length + ' Chromium groups')
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
  Date.now = originalNow
}
