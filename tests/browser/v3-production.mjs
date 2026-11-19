import { observerProbe } from './refine-list-checks.mjs'
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
const { execFileSync } = await import('node:child_process')
const { createServer } = await import('node:net')
const dataRoot = await mkdtemp(join(tmpdir(), 'hf-production-browser-'))
const file = join(dataRoot, 'fictional.db')
await initializeV3File(dataRoot, file, 'Codex RELEASE02 fictional browser')
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
  V3_STATIC_DIR: join(process.cwd(), 'dist-v3')
}
let running = await startV3Server(env)
let db = running.db
const httpEvidence = []
const browserExceptions = []
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

  await send('Page.addScriptToEvaluateOnNewDocument', { source: observerProbe })
  await go('/positions')
  await h1('登录招聘工作台')
  await fill(app.password, true)
  await h1('职位管理')
  await check('document.body.innerText.includes("暂时没有记录")', 'true empty')
  await snapshot('positions-empty')
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
  const fs = await import('node:fs/promises'),
    sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    instance = 'FINAL-DEMO-' + randomBytes(6).toString('hex'),
    steps = [],
    aux = [],
    issues = []
  let group = 'demo-e2e-01',
    j01,
    j02,
    r01,
    first,
    second,
    waiver
  const tables = [
    'positions',
    'candidates',
    'interviews',
    'feedback',
    'business_events',
    'command_receipts',
    'advancement_missing_feedback'
  ]
  const state = () =>
    Object.fromEntries(
      tables.map((t) => [
        t,
        db
          .prepare(
            'SELECT * FROM ' +
              t +
              ' ORDER BY ' +
              (t === 'command_receipts'
                ? 'command_id'
                : t === 'advancement_missing_feedback'
                  ? 'event_id,interview_id'
                  : 'id')
          )
          .all()
      ])
    )
  const c = (id) => db.prepare('SELECT * FROM candidates WHERE id=?').get(id),
    m = (id) => db.prepare('SELECT * FROM interviews WHERE id=?').get(id),
    ev = (id) =>
      db.prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id').all(id)
  const login = await fetch(app.url + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const token = (await login.json()).token
  const get = async (path) => {
    const r = await fetch(app.url + '/api/v3' + path, {
      headers: { Authorization: 'Bearer ' + token }
    })
    assert.equal(r.status, 200, path)
    return r.json()
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
  const step = async (id, fn) => {
    const before = state(),
      start = httpEvidence.length,
      at = new Date().toISOString()
    await snapshot(group + '/' + id + '-before')
    let status = '通过候选',
      error
    try {
      await fn()
    } catch (e) {
      status = '失败'
      error = e.stack
      issues.push({ group, id, error })
    }
    await snapshot(group + '/' + id + '-after')
    const record = {
      id,
      sha,
      instance,
      at,
      status,
      error,
      before,
      after: state(),
      http: httpEvidence.slice(start)
    }
    ;(group === 'demo-e2e-01' ? steps : aux).push(record)
    await writeFile(join(output, group, id + '.json'), JSON.stringify(record, null, 2))
    console.log(id + ' ' + status)
    return status === '通过候选'
  }
  await fs.mkdir(join(output, group), { recursive: true })
  const mainChain = async () => {
    if (
      !(await step('D01', async () => {
        await newPosition('虚构最终同名招聘职位')
        j01 = db.prepare('SELECT max(id) id FROM positions').get().id
        r01 = await application(j01, '虚构完整招聘主线R01')
        assert.equal(c(r01).position_id, j01)
        assert.equal(c(r01).stage, 'screening')
      }))
    )
      return
    if (
      !(await step('D02', async () => {
        await advance(r01)
        assert.equal(c(r01).stage, 'first_interview')
        assert.equal(ev(r01).at(-1).event_type, 'stage_advanced')
      }))
    )
      return
    if (
      !(await step('D03', async () => {
        first = await meeting(r01, '安排面试', null, '2026-11-13T08:00:00')
        const old = { ...m(first) }
        assert.equal(await meeting(r01, '改期', first, '2026-11-13T09:00:00'), first)
        assert.notEqual(m(first).scheduled_at, old.scheduled_at)
        assert.equal(ev(r01).at(-1).event_type, 'interview_rescheduled')
      }))
    )
      return
    if (
      !(await step('D04', async () => {
        await meeting(r01, '确认完成', first)
        assert.equal(m(first).status, 'completed')
        assert.equal(c(r01).stage, 'first_interview')
      }))
    )
      return
    if (
      !(await step('D05', async () => {
        await feedback(r01, first, '填写面评', '虚构：初面能力证据完整')
        assert.equal(
          db.prepare('SELECT recorded_by_user_id FROM feedback WHERE interview_id=?').get(first)
            .recorded_by_user_id,
          1
        )
        await advance(r01)
        assert.equal(c(r01).stage, 'second_interview')
      }))
    )
      return
    if (
      !(await step('D06', async () => {
        second = await meeting(r01, '安排面试', null, '2026-11-13T10:00:00')
        await meeting(r01, '确认完成', second)
        assert.equal(c(r01).stage, 'second_interview')
        await readyButton('核验并决定晋级', 'document.querySelector(".v3-advancement")')
        await check('!!document.querySelector(".v3-advance-editor")', 'risk editor')
        assert.ok(
          await evaluate('document.querySelector(".v3-advance-editor").innerText.includes("缺评")')
        )
        dialogMode = true
        await button('返回', 'document.querySelector(".v3-advance-editor")')
        await check('!document.querySelector(".v3-advance-editor")', 'closed precheck')
      }))
    )
      return
    if (
      !(await step('D07', async () => {
        await advance(r01, '虚构：复面记录已核实，面评稍后补录')
        waiver = ev(r01).at(-1)
        assert.equal(c(r01).offer_status, 'preparing')
        assert.ok(
          JSON.parse(waiver.context_json).missingInterviews.some((x) => x.interviewId === second)
        )
        assert.equal(
          (await get('/dashboard/work-items/feedback')).items.filter((x) => x.applicationId === r01)
            .length,
          0
        )
        await check(
          'document.body.innerText.includes("历史缺评（已说明原因推进）")',
          'historical missing'
        )
      }))
    )
      return
    if (
      !(await step('D08', async () => {
        await offer(r01, '登记 Offer 已发送')
        assert.equal(c(r01).offer_status, 'sent')
        await offer(r01, '登记候选人接受 Offer')
        assert.equal(c(r01).offer_status, 'accepted')
        assert.equal(c(r01).application_status, 'active')
        assert.equal(c(r01).outcome, null)
        assert.equal((await get('/dashboard/summary')).applicationTotals.hired, 0)
      }))
    )
      return
    if (
      !(await step('D09', async () => {
        await feedback(r01, second, '补录历史面评', '虚构：复面原始记录已核对后补录')
        assert.equal(ev(r01).at(-1).event_type, 'feedback_supplemented')
        assert.deepEqual(
          db.prepare('SELECT * FROM business_events WHERE id=?').get(waiver.id),
          waiver
        )
        assert.ok(
          db.prepare('SELECT submitted_at FROM feedback WHERE interview_id=?').get(second)
            .submitted_at > m(second).completed_at
        )
        assert.equal(c(r01).stage, 'offer')
        assert.equal(
          (await get('/dashboard/work-items/feedback')).items.filter((x) => x.applicationId === r01)
            .length,
          0
        )
      }))
    )
      return
    if (
      !(await step('D10', async () => {
        await offer(r01, 'HR 确认录用', '虚构：HR已正式核实录用事实')
        assert.equal(c(r01).application_status, 'closed')
        assert.equal(c(r01).outcome, 'hired')
        assert.equal(c(r01).stage, 'offer')
        assert.equal(ev(r01).at(-1).event_type, 'candidate_hired')
        assert.equal(ev(r01).filter((x) => x.event_type === 'offer_accepted').length, 1)
      }))
    )
      return
    await step('D11', async () => {
      const api = await get('/applications/' + r01)
      assert.equal(api.applicationStatus, c(r01).application_status)
      assert.equal(api.outcome, c(r01).outcome)
      await go('/dashboard')
      await h1('招聘工作台')
      await check('document.querySelector("[data-metric=hired]")?.textContent==="1"', 'hired UI')
      for (const e of ev(r01)) {
        const r = db.prepare('SELECT * FROM command_receipts WHERE command_id=?').get(e.command_id)
        assert.ok(r)
        assert.equal(e.actor_user_id, 1)
        assert.equal(e.aggregate_version, JSON.parse(r.result_json).version)
      }
      assert.equal(
        (await get('/dashboard/work-items/offer')).items.filter((x) => x.applicationId === r01)
          .length,
        0
      )
    })
  }
  await mainChain()
  await writeFile(
    join(output, 'demo-e2e-01.json'),
    JSON.stringify(
      {
        sha,
        instance,
        status:
          steps.length === 11 && steps.every((x) => x.status === '通过候选') ? '通过候选' : '失败',
        ids: { j01, r01, first, second },
        steps
      },
      null,
      2
    )
  )
  group = 'demo-e2e-02'
  await fs.mkdir(join(output, group), { recursive: true })
  let withdrew, rejected, declined
  await step('S01', async () => {
    await go('/positions')
    await h1('职位管理')
    await newPosition('虚构最终同名招聘职位')
    j02 = db.prepare('SELECT max(id) id FROM positions').get().id
    assert.notEqual(j01, j02)
    withdrew = await application(j01, '虚构自愿退出')
    rejected = await application(j02, '虚构企业淘汰')
    assert.equal(c(withdrew).position_id, j01)
    assert.equal(c(rejected).position_id, j02)
    const a = await get('/positions/' + j01),
      b = await get('/positions/' + j02)
    assert.equal(
      a.applicationRecords,
      db.prepare('SELECT count(*) n FROM candidates WHERE position_id=?').get(j01).n
    )
    assert.equal(
      b.applicationRecords,
      db.prepare('SELECT count(*) n FROM candidates WHERE position_id=?').get(j02).n
    )
  })
  if (withdrew)
    await step('S02', async () => {
      await offer(withdrew, '结束招聘', '虚构：候选人明确主动退出', 'candidate_withdrew')
      assert.equal(c(withdrew).outcome, 'candidate_withdrew')
      assert.equal(c(withdrew).stage, 'screening')
    })
  if (rejected)
    await step('S03', async () => {
      await offer(rejected, '结束招聘', '虚构：企业核实条件后淘汰', 'company_rejected')
      assert.equal(c(rejected).outcome, 'company_rejected')
      assert.equal(c(rejected).stage, 'screening')
    })
  await step('S04', async () => {
    declined = await application(j02, '虚构Offer拒绝')
    await advance(declined)
    await advance(declined, '虚构：资料核实后跳过初面评估')
    await advance(declined, '虚构：资料核实后跳过复面评估')
    await offer(declined, '登记 Offer 已发送')
    const hired = (await get('/dashboard/summary')).applicationTotals.hired
    await offer(declined, '登记候选人拒绝 Offer', '虚构：候选人明确拒绝本次Offer')
    assert.equal(c(declined).stage, 'offer')
    assert.equal(c(declined).offer_status, 'declined')
    assert.equal(c(declined).outcome, 'offer_declined')
    assert.equal(c(declined).application_status, 'closed')
    assert.equal((await get('/dashboard/summary')).applicationTotals.hired, hired)
  })
  await writeFile(
    join(output, 'demo-e2e-02.json'),
    JSON.stringify(
      {
        sha,
        instance,
        status: aux.length === 4 && aux.every((x) => x.status === '通过候选') ? '通过候选' : '失败',
        ids: { j01, j02, withdrew, rejected, declined },
        steps: aux
      },
      null,
      2
    )
  )
  const views = []
  await detail(r01 ?? withdrew)
  for (const w of [1440, 390, 320]) {
    await width(w)
    await check('window.innerWidth===' + w, 'viewport')
    await snapshot('view-' + w)
    views.push({
      width: w,
      ...(await evaluate(
        '({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,editors:document.querySelectorAll(".v3-editor,.v3-feedback-editor,.v3-offer-editor,.v3-advance-editor,.v3-interview-editor").length})'
      ))
    })
  }
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
  const focus = await evaluate(
    '({tag:document.activeElement.tagName,label:document.activeElement.getAttribute("aria-label"),text:document.activeElement.textContent?.slice(0,80)})'
  )

  await width(1440)
  const deepLinks = []
  for (const [route, title] of [
    ['/dashboard', '招聘工作台'],
    ['/positions', '职位管理'],
    ['/candidates', '候选人管理'],
    ['/interviews', '面试管理'],
    ['/legacy-records', '旧版档案'],
    ['/legacy-records/detail?sourceKey=fictional&entityType=candidate&legacyId=999', '旧档详情']
  ]) {
    await go(route)
    await h1(title)
    deepLinks.push({ route, title, status: 'passed' })
  }
  await detail(r01)
  const countsBeforeRestart = Object.fromEntries(
    tables.map((t) => [t, db.prepare('SELECT count(*) n FROM ' + t).get().n])
  )
  await running.close()
  running = await startV3Server(env)
  db = running.db
  const { get: httpGet } = await import('node:http')
  const freshGet = (route, headers = {}) =>
    new Promise((resolve, reject) => {
      httpGet(app.url + route, { agent: false, headers }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
      }).on('error', reject)
    })
  const me = await freshGet('/api/v3/auth/me', { Authorization: 'Bearer ' + token })
  assert.equal(me.status, 200)
  await go('/candidates/' + r01)
  await h1('申请详情')
  await check('document.body.innerText.includes("已录用")', 'persisted final outcome')
  assert.deepEqual(
    Object.fromEntries(
      tables.map((t) => [t, running.db.prepare('SELECT count(*) n FROM ' + t).get().n])
    ),
    countsBeforeRestart
  )
  const noauth = await freshGet('/api/v3/applications')
  assert.equal(noauth.status, 401)
  const unknown = await freshGet('/api/v3/not-a-route')
  assert.equal(unknown.status, 404)
  assert.match(unknown.headers['content-type'], /json/)
  await writeFile(
    join(output, 'production-dist.json'),
    JSON.stringify(
      {
        executor: 'Codex',
        sha,
        mode: 'production',
        frontend: 'dist-v3 (DEV=false)',
        deepLinks,
        restart: { sameJWT: true, rowsUnchanged: countsBeforeRestart },
        unauthenticated: noauth.status,
        apiNotSpa: unknown.status,
        productionDatabaseAccess: false
      },
      null,
      2
    )
  )
  // Use the reopened connection for final readonly evidence after a real server restart.
  const orphan = db
    .prepare(
      'SELECT e.id FROM business_events e LEFT JOIN command_receipts r ON e.command_id=r.command_id WHERE r.command_id IS NULL'
    )
    .all()
  assert.equal(orphan.length, 0)
  const all = state(),
    audit = {
      sha,
      instance,
      issues,
      views,
      focus,
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all(),
      integrity: db.prepare('PRAGMA integrity_check').all(),
      orphanEvents: orphan,
      v2Requests: requests.filter((u) => /^\/api\/(?!v3\/)/.test(new URL(u).pathname)).length,
      http5xx: httpEvidence.filter((x) => x.status >= 500),
      qualificationRequests: httpEvidence.filter((x) => x.path.includes('/advance/preflight')),
      allState: all,
      browserExceptions,
      native200: '未验证；headless CDP视口/页面缩放不是浏览器原生200%，未使用CSS zoom冒充',
      device: 'desktop Chromium viewport emulation; not real device or screen reader',
      observation: 'E4-01C-OBS-01 stays open; inspect qualificationRequests for this run'
    }
  await writeFile(join(output, 'comprehensive-audit.json'), JSON.stringify(audit, null, 2))
  assert.deepEqual(browserExceptions, [])
  assert.equal(audit.v2Requests, 0)
  assert.equal(issues.length, 0)
  assert.equal(steps.length, 11)
  assert.equal(aux.length, 4)
  assert.equal(audit.http5xx.length, 0)
  console.log(
    JSON.stringify({
      steps: steps.map((x) => [x.id, x.status]),
      aux: aux.map((x) => [x.id, x.status]),
      views
    })
  )
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
}
