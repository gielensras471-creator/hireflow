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
const secret = randomBytes(48).toString('hex')
const db = openDatabase(':memory:')
createV3Schema(db)
const username = 'local-hr'
const password = randomBytes(18).toString('base64url')
db.prepare(
  'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
).run(username, bcrypt.hashSync(password, 10), '本地演示 HR', 'hr', '', '', '')
let deny = false,
  drop = false,
  failMe = false,
  failList = false
const { default: express } = await import(root('node_modules/express/index.js'))
const wrapped = express()
let legacyFailure = false,
  legacyDelay = false
const httpEvidence = []
wrapped.use(express.json())
wrapped.use((req, res, next) => {
  if (!req.path.includes('/auth/')) {
    const json = res.json.bind(res)
    res.json = (body) => {
      httpEvidence.push({
        method: req.method,
        path: req.originalUrl,
        body: req.body,
        idempotencyKey: req.get('Idempotency-Key'),
        status: res.statusCode,
        response: body
      })
      return json(body)
    }
  }
  next()
})
wrapped.use((req, res, next) => {
  if (req.path.startsWith('/api/v3/legacy-records')) {
    if (legacyFailure)
      return res.status(503).json({ error: { code: 'COMMAND_BUSY', message: 'fixture failure' } })
    if (legacyDelay) {
      legacyDelay = false
      return setTimeout(next, 1500)
    }
  }
  next()
})
wrapped.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/api/v3/applications' && req.query.q === 'slow')
    return setTimeout(next, 2500)
  if (failMe && req.path === '/api/v3/auth/me')
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (failList && req.method === 'GET' && req.path === '/api/v3/applications')
    return res.status(503).json({ error: { code: 'TEST_BUSY', message: 'fixture' } })
  if (deny && req.method === 'PATCH') {
    deny = false
    return res.status(403).json({ error: { code: 'OPERATION_DENIED', message: 'fixture' } })
  }
  if (drop && req.method === 'POST' && req.path === '/api/v3/applications') {
    drop = false
    res.json = () => {
      res.socket.destroy()
      return res
    }
  }
  next()
})
let servingApp = createV3App({ db, authConfig: { jwtSecret: secret } })
wrapped.use((req, res, next) => servingApp(req, res, next))
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
const additionalCleanup = []
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
  const fs = await import('node:fs/promises'),
    { createHash } = await import('node:crypto'),
    { DatabaseSync } = await import('node:sqlite'),
    { createMigrationSandbox } = await import(root('server/db/migration-sandbox.js'))
  const sha = (await import('node:child_process'))
      .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim(),
    instance = 'AC16-FIX-' + randomBytes(6).toString('hex'),
    results = [],
    injected = [],
    resources = additionalCleanup
  let currentAc = 'setup',
    serial = 0,
    evidenceDb = db
  const allHttp = httpEvidence
  const plain = (v) => JSON.parse(JSON.stringify(v)),
    hash = (v) => createHash('sha256').update(v).digest('hex')
  const tables = [
    'positions',
    'candidates',
    'interviews',
    'feedback',
    'business_events',
    'command_receipts',
    'advancement_missing_feedback',
    'legacy_records',
    'schema_migrations'
  ]
  const state = (connection = evidenceDb) =>
    Object.fromEntries(
      tables.map((t) => [
        t,
        connection
          .prepare(
            'SELECT * FROM ' +
              t +
              ' ORDER BY ' +
              (t === 'command_receipts'
                ? 'command_id'
                : t === 'advancement_missing_feedback'
                  ? 'event_id,interview_id'
                  : t === 'legacy_records'
                    ? 'source_key,entity_type,legacy_id'
                    : t === 'schema_migrations'
                      ? 'version'
                      : 'id')
          )
          .all()
      ])
    )
  const file = (name, data) =>
    writeFile(join(output, currentAc, name + '.json'), JSON.stringify(data, null, 2))
  const run = async (id, fn) => {
    currentAc = id
    await fs.mkdir(join(output, id), { recursive: true })
    const before = state(),
      start = allHttp.length
    let status = '通过候选',
      error
    try {
      const returned = await fn()
      if (returned) status = returned
    } catch (e) {
      status = '失败'
      error = e.stack
      console.log(id + ' ' + error)
    }
    results.push({ id, status, error })
    await file('evidence', {
      sha,
      instance,
      executor: 'Codex',
      at: new Date().toISOString(),
      status,
      error,
      before,
      after: state(),
      http: allHttp.slice(start)
    })
    console.log(id + ' ' + status)
  }
  const request = async (base, path, token, method = 'GET', body, customKey) => {
    const res = await fetch(base + '/api/v3' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body
          ? { 'Content-Type': 'application/json', 'Idempotency-Key': customKey ?? 'f-' + ++serial }
          : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    return { status: res.status, data: await res.json() }
  }
  const login = async (base) => {
    const res = await fetch(base + '/api/v3/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    assert.equal(res.status, 200)
    return (await res.json()).token
  }
  const token = await login(app.url)
  const box = createMigrationSandbox(),
    ownedRoot = box.root,
    allReports = [],
    migrationResults = []
  const safeBoxFile = (name) => {
    const p = join(ownedRoot, name)
    assert.ok(!name.includes('..') && !name.includes('/') && !name.includes('\\'))
    return p
  }
  const position = (id, title, count = 0) => ({
    id,
    title,
    department: '虚构部门',
    location: '上海',
    status: 'open',
    candidate_count: count,
    publish_date: '2026-11-03',
    description: '虚构V2来源'
  })
  const candidate = (id, position, stage) => ({
    id,
    name: '虚构旧申请-' + id,
    position,
    education: '',
    school: '',
    phone: '',
    email: '',
    stage,
    owner: '虚构旧负责人',
    applied_date: '2026-11-03'
  })
  const oldMeeting = (id, candidateId) => ({
    id,
    candidate_id: candidateId,
    candidate_name: '虚构旧申请-' + candidateId,
    position: '唯一旧职位',
    date: '',
    time: '',
    interviewer: '虚构旧面试官',
    type: '未知原轮次',
    status: 'completed'
  })
  const sourceDigest = (rows) =>
    hash(
      JSON.stringify(
        Object.fromEntries(
          ['positions', 'candidates', 'interviews'].map((t) => [
            t,
            [...rows[t]]
              .sort((a, b) => a.id - b.id)
              .map((r) =>
                Object.fromEntries(
                  Object.keys(r)
                    .sort()
                    .map((k) => [k, r[k]])
                )
              )
          ])
        )
      )
    )
  const diskHash = async (name) => hash(await fs.readFile(safeBoxFile(name)))
  let legacySource, legacyBefore, legacyTarget, legacyReport, legacyMemory
  await run('AC-16', async () => {
    const fixture = {
      positions: [
        position(101, '唯一旧职位', 2),
        position(102, '同名', 1),
        position(103, '同名', 1)
      ],
      candidates: [
        candidate(101, '唯一旧职位', 'rejected'),
        candidate(102, '唯一旧职位', 'offer'),
        candidate(103, '不存在', 'rejected'),
        candidate(104, '同名', 'offer')
      ],
      interviews: [
        oldMeeting(201, 101),
        oldMeeting(202, 102),
        ...Array.from({ length: 22 }, (_, i) => oldMeeting(210 + i, 101))
      ]
    }
    legacySource = await box.createSource('legacy-source.db', fixture)
    legacyBefore = await box.inspect('legacy-source.db')
    const sourceHashBefore = await diskHash('legacy-source.db')
    assert.equal(legacyBefore.integrity[0], 'ok')
    await box.createTarget('legacy-target.db')
    legacyReport = await box.migrate('legacy-source.db', 'legacy-target.db', {
      executor: 'Codex E4-01F fictional migration'
    })
    legacyTarget = await box.inspect('legacy-target.db')
    allReports.push({ case: 'legacy-facts', report: legacyReport })
    assert.equal(legacyReport.source_fingerprint, sourceDigest(legacyBefore.rows))
    assert.deepEqual(legacyReport.archiveCounts, { positions: 3, candidates: 4, interviews: 24 })
    assert.equal(legacyTarget.counts.business_events, 0)
    assert.equal(legacyTarget.counts.command_receipts, 0)
    assert.equal(legacyTarget.counts.candidates, 0)
    assert.equal(legacyTarget.counts.interviews, 0)
    assert.equal(legacyTarget.counts.feedback, 0)
    for (const row of legacyTarget.rows.legacy_records)
      assert.deepEqual(
        JSON.parse(row.raw_json),
        plain(legacyBefore.rows[row.entity_type].find((x) => x.id === row.legacy_id))
      )
    const legacy = (type, id) =>
      legacyTarget.rows.legacy_records.find((x) => x.entity_type === type && x.legacy_id === id)
    const rejected = JSON.parse(legacy('candidates', 101).facts_json),
      offer = JSON.parse(legacy('candidates', 102).facts_json)
    assert.deepEqual(rejected, {
      stage: null,
      application_status: 'closed',
      outcome: 'company_rejected',
      offer_status: null,
      closed_at: null,
      closed_reason: null
    })
    assert.deepEqual(offer, {
      stage: 'offer',
      application_status: null,
      outcome: null,
      offer_status: null,
      closed_at: null,
      closed_reason: null
    })
    for (const row of legacyTarget.rows.legacy_records.filter(
      (x) => x.entity_type === 'interviews'
    )) {
      const facts = JSON.parse(row.facts_json)
      assert.equal(facts.stage_scope, null)
      assert.equal(facts.scheduled_at, null)
      assert.equal(facts.completed_at, null)
      assert.equal(facts.cancelled_at, null)
      assert.equal(facts.status, 'completed')
    }
    assert.deepEqual(await box.inspect('legacy-source.db'), legacyBefore)
    assert.equal(await diskHash('legacy-source.db'), sourceHashBefore)
    legacyMemory = openDatabase(':memory:')
    createV3Schema(legacyMemory)
    legacyMemory
      .prepare(
        'INSERT INTO users(username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
      )
      .run(username, bcrypt.hashSync(password, 10), '本地演示 HR', 'hr', '', '', '')
    for (const t of ['positions', 'legacy_records', 'schema_migrations'])
      for (const row of legacyTarget.rows[t]) {
        const keys = Object.keys(row)
        legacyMemory
          .prepare(
            'INSERT INTO ' +
              t +
              ' (' +
              keys.join(',') +
              ') VALUES (' +
              keys.map(() => '?').join(',') +
              ')'
          )
          .run(...keys.map((k) => row[k]))
      }
    for (const t of ['positions', 'legacy_records', 'schema_migrations'])
      assert.deepEqual(
        plain(legacyMemory.prepare('SELECT * FROM ' + t).all()),
        plain(legacyTarget.rows[t])
      )
    servingApp = createV3App({ db: legacyMemory, authConfig: { jwtSecret: secret } })
    evidenceDb = legacyMemory
    resources.push(async () => legacyMemory.close())
    const protectedReads = []
    for (const row of legacyTarget.rows.legacy_records) {
      const query =
          '?sourceKey=' +
          legacyReport.source_fingerprint +
          '&entityType=' +
          row.entity_type +
          '&legacyId=' +
          row.legacy_id,
        response = await request(app.url, '/legacy-records' + query, token)
      assert.equal(response.status, 200)
      assert.equal(response.data.historyStatus, 'history_unknown')
      assert.equal(response.data.importedAt, row.imported_at)
      assert.equal(response.data.legacyId, row.legacy_id)
      protectedReads.push({ query, response })
    }
    const anon = await fetch(
      app.url +
        '/api/v3/legacy-records?sourceKey=' +
        legacyReport.source_fingerprint +
        '&entityType=candidates&legacyId=101'
    )
    assert.equal(anon.status, 401)
    assert.equal((await request(app.url, '/applications?limit=100&offset=0', token)).data.total, 0)
    assert.equal(
      (await request(app.url, '/dashboard/summary', token)).data.activeApplications.count,
      0
    )

    const prior = state(legacyMemory),
      uiStart = allHttp.length
    await click('a[href="/legacy-records"]')
    await h1('旧版档案')
    await check('document.querySelectorAll("table tbody tr").length===20', 'list first page')
    await snapshot('AC-16/list')
    await button('下一页旧档')
    await check('document.querySelectorAll("table tbody tr").length===11', 'next page')
    await button('上一页旧档')
    await check('document.querySelectorAll("table tbody tr").length===20', 'previous page')
    legacyDelay = true
    await go('/legacy-records')
    await h1('旧版档案')
    await check('!!document.querySelector("[data-state=loading]")', 'loading visible')
    await snapshot('AC-16/loading')
    await check('document.querySelectorAll("table tbody tr").length===20', 'loaded')
    legacyFailure = true
    await button('筛选档案')
    await check('document.body.innerText.includes("暂时无法读取旧档")', '503 shown')
    await snapshot('AC-16/error')
    legacyFailure = false
    await button('重新读取旧档')
    await check('document.querySelectorAll("table tbody tr").length===20', 'retry recovered')
    const open = async (type, id) => {
      await go('/legacy-records')
      await h1('旧版档案')
      await check('!!document.querySelector("table tbody tr a")', 'list loaded')
      if (type === 'interviews') {
        await input('旧档实体类型', 'interviews')
        await button('筛选档案')
        await check('!!document.querySelector("table tbody tr a")', 'filtered')
      }
      const links = await evaluate(
        '[...document.querySelectorAll("table tbody tr a")].map(e=>e.getAttribute("href"))'
      )
      const link = links.find(
        (x) =>
          new URL(x, app.url).searchParams.get('legacyId') === String(id) &&
          new URL(x, app.url).searchParams.get('entityType') === type
      )
      assert.ok(link)
      await evaluate(
        'document.querySelectorAll("table tbody tr a")[' + links.indexOf(link) + '].click()'
      )
      await h1('旧档详情')
      await check('!!document.querySelector("[aria-label=只读旧档详情]")', 'detail loaded')
      assert.ok(
        await evaluate(
          'document.querySelector("[aria-label=只读旧档详情]").innerText.includes("#' + id + '")'
        )
      )
      assert.equal(
        await evaluate(
          'document.querySelector("[aria-label=只读旧档详情]").querySelectorAll("button,form").length'
        ),
        0
      )
      return await evaluate('document.querySelector("[aria-label=只读旧档详情]").innerText')
    }
    const rejectedText = await open('candidates', 101)
    assert.ok(rejectedText.includes('企业淘汰') && rejectedText.includes('未知，待核实'))
    await snapshot('AC-16/rejected')
    const offerText = await open('candidates', 102)
    assert.ok(offerText.includes('子状态未知') && !offerText.includes('已录用'))
    await snapshot('AC-16/offer')
    const interviewText = await open('interviews', 201)
    assert.ok(interviewText.includes('原面试轮次') && interviewText.includes('未知，待核实'))
    await snapshot('AC-16/interview')
    await send('Page.reload')
    await h1('旧档详情')
    await check('!!document.querySelector("[aria-label=只读旧档详情]")', 'direct refresh works')
    const mappings = []
    for (const id of [103, 104]) {
      const t = await open('candidates', id)
      assert.ok(t.includes(id === 103 ? '无匹配，待核实' : '同名歧义，待核实'))
      assert.ok(t.includes('不是有效新申请'))
      mappings.push({ id, text: t })
      await snapshot('AC-16/mapping-' + id)
    }
    await go('/legacy-records')
    await h1('旧版档案')
    await input('旧档实体类型', 'positions')
    await input('旧档映射状态', 'ambiguous')
    await button('筛选档案')
    await check('document.body.innerText.includes("暂无符合条件")', 'true empty')
    await snapshot('AC-16/empty')
    await go(
      '/legacy-records/detail?sourceKey=' +
        legacyReport.source_fingerprint +
        '&entityType=candidates&legacyId=999'
    )
    await h1('旧档详情')
    await check('document.body.innerText.includes("未找到旧档记录")', 'not found')
    await snapshot('AC-16/not-found')
    assert.deepEqual(state(legacyMemory), prior)
    assert.ok(!allHttp.slice(uiStart).some((x) => !['GET', 'HEAD', 'OPTIONS'].includes(x.method)))
    legacyMemory.prepare("UPDATE users SET role='viewer' WHERE id=1").run()
    const forbidden = await request(app.url, '/legacy-records/list', token)
    assert.equal(forbidden.status, 403)
    await go('/legacy-records')
    await h1('登录招聘工作台')
    await snapshot('AC-16/forbidden')
    await file('migration-facts-proof', {
      report: legacyReport,
      target: legacyTarget,
      sourceBefore: legacyBefore,
      sourceAfter: await box.inspect('legacy-source.db'),
      protectedReads,
      apiProjection:
        'Exact migrated archive rows cloned to approved in-memory app, schema_migrations preserved; fictional HR only',
      ui: { rejectedText, offerText, interviewText, mappings },
      noWrites: true
    })
    return '通过候选'
  })

  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        sha,
        instance,
        executor: 'Codex',
        results,
        v2Requests: requests.filter((u) => /^\/api\/(?!v3\/)/.test(new URL(u).pathname)).length
      },
      null,
      2
    )
  )
  console.log(JSON.stringify(results))
  assert.ok(
    results.every((r) => r.status === '通过候选'),
    'all AC16 browser assertions must pass'
  )
} finally {
  ws?.close()
  chrome.kill()
  for (const close of additionalCleanup.reverse()) await close()
  await app.close()
}
