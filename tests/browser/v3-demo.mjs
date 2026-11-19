import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { startDemoServer } from '../../server/index-demo-v3.js'
const output = process.argv[2]
if (!output) throw new Error('Provide a new evidence directory')
await mkdir(output, { recursive: false })
const profile = await mkdtemp(join(tmpdir(), 'hireflow-demo-chrome-'))
const password = randomBytes(18).toString('hex')
const running = await startDemoServer({ password, port: 0 })
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

const stages = []
const c = (id) => db.prepare('SELECT * FROM candidates WHERE id=?').get(id)
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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
      consoleErrors.push(m.params.args.map((x) => x.value ?? x.description).join(' '))
    if (m.method === 'Network.loadingFailed' && m.params.errorText !== 'net::ERR_ABORTED')
      networkFailures.push(m.params.errorText)
    if (m.method === 'Runtime.exceptionThrown')
      browserExceptions.push(m.params.exceptionDetails.text)
    if (m.method === 'Network.requestWillBeSent') {
      const { request, requestId } = m.params
      requests.push(request.url)
      const u = new URL(request.url)
      if (u.pathname.startsWith('/api/') && !u.pathname.includes('/auth/'))
        httpEvidence.push({
          requestId,
          method: request.method,
          path: u.pathname + u.search,
          body: request.postData,
          idempotencyKey: request.headers['Idempotency-Key']
        })
    }
    if (m.method === 'Network.responseReceived') {
      const row = httpEvidence.find((x) => x.requestId === m.params.requestId)
      if (row) row.status = m.params.response.status
    }

    if (
      m.method === 'Network.responseReceived' &&
      m.params.response.url.endsWith('/api/v3/auth/me')
    )
      meStatuses.push(m.params.response.status)
    if (m.method === 'Page.javascriptDialogOpening' && dialogMode !== null)
      void send('Page.handleJavaScriptDialog', { accept: dialogMode })
  }
  await Promise.all([
    send('Page.enable'),
    send('Network.enable'),
    send('Runtime.enable'),
    width(1440)
  ])

  await go('/login')
  await h1('登录公开演示工作台')
  await check('document.getElementById("v3-username").value === "demo_admin"', 'demo prefill')
  await check(
    'document.getElementById("v3-password").value === "a123456"',
    'public password prefill'
  )
  await check('document.body.innerText.includes("密码：a123456")', 'public password shown')
  await check('document.body.innerText.includes("请勿输入真实个人信息")', 'privacy notice')
  await snapshot('demo-login')
  await fill(password)
  await h1('招聘工作台')
  await check('document.body.innerText.includes("招聘管理员（演示）")', 'identity')
  await snapshot('demo-dashboard')
  const button = async (text, scope = 'document') => {
    const expression =
      '([...(' +
      scope +
      '?.querySelectorAll("button") ?? [])].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      '))'
    await check(expression + ' !== undefined', 'button ' + text)
    return evaluate(expression + '?.click()')
  }
  const input = async (label, value) =>
    evaluate(
      '(()=>{const e=document.querySelector("[aria-label=\\"' +
        label +
        '\\"]");e.value=' +
        JSON.stringify(value) +
        ';e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()'
    )
  const save = async () => {
    await check('!!document.querySelector(".v3-editor form")', 'editor ready')
    return evaluate('document.querySelector(".v3-editor form").requestSubmit()')
  }
  const newPosition = async (title) => {
    await button('＋ 新建职位')
    await check('!!document.querySelector(".v3-editor")', 'position form')
    await input('职位名称', title)
    await input('部门', '研发')
    await input('工作地点', '上海')
    await input('发布日期', '2026-11-09')
    await input('职位描述', '虚构验收职位')
    await save()
    await check('!document.querySelector(".v3-editor")', 'position saved')
  }

  const detail = async (id) => {
    await go('/candidates/' + id)
    await h1('申请详情')
    await check(
      'document.querySelector(".v3-detail-summary h2")?.textContent.includes("申请 #' + id + '")',
      'detail ID'
    )
    await check(
      '!!document.querySelector(".v3-offer")&&!document.querySelector(".v3-offer-loading")&&!document.querySelector(".v3-feedback-loading")',
      'business panels read'
    )
  }
  const readyButton = async (text, scope = 'document') => {
    await check(
      '([...(' +
        scope +
        '?.querySelectorAll("button")??[])].find(e=>e.textContent.trim()===' +
        JSON.stringify(text) +
        ')&&!([...(' +
        scope +
        '?.querySelectorAll("button")??[])].find(e=>e.textContent.trim()===' +
        JSON.stringify(text) +
        ')).disabled)',
      'enabled ' + text
    )
    await button(text, scope)
  }
  const advance = async (id, reason = '') => {
    await detail(id)
    await readyButton('核验并决定晋级', 'document.querySelector(".v3-advancement")')
    await check('!!document.querySelector(".v3-advance-editor")', 'advance form')
    if (reason) await input('晋级理由', reason)
    dialogMode = true
    await evaluate('document.querySelector(".v3-advance-editor form").requestSubmit()')
    await check('!document.querySelector(".v3-advance-editor")', 'advance saved')
    await detail(id)
  }
  const application = async (job, name) => {
    await go('/candidates')
    await h1('候选人管理')
    await readyButton('＋ 添加申请')
    await check('!!document.querySelector(".v3-editor")', 'application editor')
    await check(
      '[...document.querySelectorAll("[aria-label=应聘职位] option")].some(e=>e.value===' +
        JSON.stringify(String(job)) +
        ')',
      'position options'
    )
    await input('应聘职位', String(job))
    await input('姓名', name)
    await input('业务负责人', '虚构业务负责人')
    await input('申请日期', '2026-11-13')
    await save()
    await check('!document.querySelector(".v3-editor")', 'application saved')
    const row = db
      .prepare('SELECT * FROM candidates WHERE name=? ORDER BY id DESC LIMIT 1')
      .get(name)
    assert.ok(row)
    await detail(row.id)
    return row.id
  }
  const meeting = async (id, action, mid, time) => {
    await detail(id)
    const scope =
      action === '安排面试'
        ? 'document.querySelector(".v3-interviews")'
        : 'document.querySelector("tr[data-interview-id=\\"' + mid + '\\"]")'
    await readyButton(action, scope)
    await check('!!document.querySelector(".v3-interview-editor")', 'interview editor')
    if (time) await input('预约开始时间', time)
    if (action === '安排面试') await input('专业面试官姓名', '虚构专业面试官')
    dialogMode = true
    await evaluate('document.querySelector(".v3-interview-editor form").requestSubmit()')
    await check('!document.querySelector(".v3-interview-editor")', 'interview saved')
    await detail(id)
    return db
      .prepare('SELECT id FROM interviews WHERE candidate_id=? ORDER BY id DESC LIMIT 1')
      .get(id).id
  }
  const feedback = async (id, mid, action, reason) => {
    await detail(id)
    await readyButton(
      action,
      'document.querySelector("[data-feedback-interview=\\"' + mid + '\\"]")'
    )
    await check('!!document.querySelector(".v3-feedback-editor")', 'feedback editor')
    await input('专业评价人姓名', '虚构专业评价人')
    await input('推荐依据', reason)
    await evaluate('document.querySelector(".v3-feedback-editor input[value=recommend]").click()')
    await evaluate('document.querySelector(".v3-feedback-editor form").requestSubmit()')
    await check('!document.querySelector(".v3-feedback-editor")', 'feedback saved')
    await detail(id)
  }
  const offer = async (id, action, reason, outcome) => {
    await detail(id)
    await readyButton(action, 'document.querySelector(".v3-offer")')
    await check('!!document.querySelector(".v3-offer-editor")', 'offer form')
    if (outcome) await input('结束类型', outcome)
    if (reason) await input('结束原因', reason)
    dialogMode = true
    await evaluate('document.querySelector(".v3-offer-editor form").requestSubmit()')
    await check('!document.querySelector(".v3-offer-editor")', 'offer saved')
    await detail(id)
  }

  await go('/positions')
  await h1('职位管理')
  await check('document.body.innerText.includes("[虚构演示]")', 'seeded positions')
  await newPosition('[虚构演示] 浏览器完整流程')
  const job = db.prepare('SELECT max(id) id FROM positions').get().id
  const id = await application(job, '[虚构演示] 浏览器完整体验')
  await advance(id)
  stages.push({ stage: c(id).stage })
  const first = await meeting(id, '安排面试', null, '2026-11-17T09:00:00')
  await meeting(id, '确认完成', first)
  assert.equal(c(id).stage, 'first_interview')
  await feedback(id, first, '填写面评', '虚构初面：依据完整，建议复面')
  await advance(id)
  const second = await meeting(id, '安排面试', null, '2026-11-17T10:00:00')
  await meeting(id, '确认完成', second)
  await feedback(id, second, '填写面评', '虚构复面：依据完整，建议继续')
  await advance(id)
  assert.equal(c(id).offer_status, 'preparing')
  await offer(id, '登记 Offer 已发送')
  await offer(id, '登记候选人接受 Offer')
  assert.equal(c(id).offer_status, 'accepted')
  assert.equal(c(id).application_status, 'active')
  assert.equal(c(id).outcome, null)
  stages.push({ offer: 'accepted', status: c(id).application_status, outcome: c(id).outcome })
  await snapshot('demo-offer-accepted')
  await offer(id, 'HR 确认录用', '虚构演示：HR确认录用')
  assert.equal(c(id).outcome, 'hired')
  stages.push({ outcome: c(id).outcome })
  await snapshot('demo-hired')
  for (const [path, title] of [
    ['/interviews', '面试管理'],
    ['/profile', '个人中心'],
    ['/candidates/' + id, '申请详情']
  ]) {
    await go(path)
    await h1(title)
  }
  await width(390)
  await check('document.documentElement.scrollWidth <= innerWidth+1', 'mobile overflow')
  await snapshot('demo-mobile')
  const events = db.prepare('SELECT count(*) n FROM business_events').get().n
  const receipts = db.prepare('SELECT count(*) n FROM command_receipts').get().n
  assert.equal(events, receipts)
  assert.equal(db.prepare('SELECT count(*) n FROM users').get().n, 1)
  const v2 = requests.filter(
    (u) => new URL(u).pathname.startsWith('/api/') && !new URL(u).pathname.startsWith('/api/v3/')
  )
  const external = requests.filter(
    (u) => new URL(u).pathname.startsWith('/api/') && new URL(u).origin !== app.url
  )
  assert.equal(v2.length, 0)
  assert.equal(external.length, 0)
  assert.deepEqual(browserExceptions, [])
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(networkFailures, [])
  assert.ok(
    httpEvidence.every((r) => r.status === undefined || r.status < 400),
    'Unexpected API error'
  )
  const sourceHash = createHash('sha256')
    .update(execFileSync('git', ['diff', '--binary']))
    .digest('hex')
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        executor: 'Codex',
        at: new Date().toISOString(),
        base: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        uncommittedSource: true,
        trackedDiffSha256: sourceHash,
        browser: (await send('Browser.getVersion')).product,
        status: 'passed',
        username: 'demo_admin',
        role: 'hr',
        seed: { positions: 6, applications: 32, interviews: 18, feedback: 12 },
        stages,
        events,
        receipts,
        v2Requests: v2.length,
        externalApiRequests: external.length,
        browserExceptions,
        consoleErrors,
        networkFailures,
        apiRequestCount: httpEvidence.length,
        http: httpEvidence
      },
      null,
      2
    )
  )
  console.log(
    'Demo Chromium full UI workflow passed; events=' +
      events +
      ' receipts=' +
      receipts +
      ' V2 requests=0 external API requests=0'
  )
} catch (error) {
  await snapshot('failure').catch(() => {})
  await writeFile(
    join(output, 'failure.json'),
    JSON.stringify(
      { message: error.message, stack: error.stack, browserExceptions, http: httpEvidence },
      null,
      2
    )
  )
  throw error
} finally {
  ws?.close()
  chrome.kill()
  await running.close()
}
