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
wrapped.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/api/v3/applications' && req.query.q === 'slow')
    return setTimeout(next, 800)
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
wrapped.use(createV3App({ db, authConfig: { jwtSecret: randomBytes(48).toString('hex') } }))
const api = await new Promise((resolve) => {
  const server = wrapped.listen(0, '127.0.0.1', () => resolve(server))
})
const vite = await createServer({
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
  const end = Date.now() + ms
  let last
  while (Date.now() < end) {
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
  await newPosition('同名验收职位')
  await newPosition('同名验收职位')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM positions').get().n, 2)
  await snapshot('positions')
  await button('编辑', 'document.querySelector("tbody tr")')
  await check('!!document.querySelector(".v3-editor")', 'edit opened')
  await input('职位名称', '保留的职位草稿')
  deny = true
  await save()
  await check(
    'document.querySelector(".v3-editor")?.textContent.includes("当前操作未获允许")',
    'operation 403'
  )
  assert.ok(await evaluate('!!document.querySelector(".v3-account")'))
  await snapshot('operation-403')
  // A real second writer advances the same aggregate through the HTTP contract.
  const login = await fetch(app.url + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const token = (await login.json()).token
  const position = db.prepare('SELECT id,version FROM positions ORDER BY id ASC LIMIT 1').get()
  const competing = await fetch(app.url + '/api/v3/positions/' + position.id, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'Idempotency-Key': 'fixture-competing'
    },
    body: JSON.stringify({ expectedVersion: position.version, location: '杭州' })
  })
  assert.equal(competing.status, 200)
  await save()
  await check(
    'document.querySelector(".v3-conflict")?.textContent.includes("已读取服务器最新版本")',
    '409 server reread'
  )
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"职位名称\\"]").value'),
    '保留的职位草稿'
  )
  await snapshot('conflict-409')
  dialogMode = true
  await button('确认按新版本提交草稿')
  await check('!document.querySelector(".v3-editor")', 'confirmed new intent')
  assert.equal(
    db.prepare('SELECT title FROM positions WHERE id=?').get(position.id).title,
    '保留的职位草稿'
  )
  await click('.v3-sidebar a[href="/candidates"]')
  await h1('候选人管理')
  await button('＋ 添加申请')
  await check('document.querySelectorAll(".v3-editor option").length===3', 'real options')
  await input('应聘职位', '1')
  await input('姓名', '虚构申请人')
  await input('业务负责人', '演示 HR')
  await input('申请日期', '2026-11-09')
  failMe = true
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  await check('document.body.innerText.includes("连接暂时中断")', 'identity outage')
  assert.equal(
    await evaluate('document.querySelector("[aria-label=\\"姓名\\"]").value'),
    '虚构申请人'
  )
  assert.ok(await evaluate('document.querySelector(".v3-editor fieldset").disabled'))
  await snapshot('draft-offline')
  failMe = false
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.v3Session.refresh())')
  drop = true
  await save()
  await check(
    'document.querySelector(".v3-editor")?.textContent.includes("提交结果尚未确定")',
    'lost response'
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 1)
  await snapshot('uncertain-write')
  await save()
  await check('!document.querySelector(".v3-editor")', 'idempotent replay')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM candidates').get().n, 1)
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM business_events WHERE event_type='candidate_created'").get()
      .n,
    1
  )
  await button('编辑', 'document.querySelector("tbody tr")')
  await check('!!document.querySelector(".v3-editor")', 'application edit')
  await input('电话', '13800000000')
  await save()
  await check('!document.querySelector(".v3-editor")', 'application edited')
  assert.equal(db.prepare('SELECT phone FROM candidates WHERE id=1').get().phone, '13800000000')
  assert.equal(db.prepare('SELECT position_id FROM candidates WHERE id=1').get().position_id, 1)
  await snapshot('applications')
  await width(390)
  await check('document.querySelector(".v3-shell").dataset.tier==="mobile"', 'mobile list')
  assert.ok(await evaluate('document.documentElement.scrollWidth <= 390'))
  await snapshot('applications-mobile')
  await width(1440)
  await check('document.querySelector(".v3-shell").dataset.tier==="desktop"', 'desktop list')
  await button('查看详情', 'document.querySelector("tbody tr")')
  await h1('申请详情')
  await check(
    'document.body.innerText.includes("申请状态")&&document.body.innerText.includes("Offer 状态")',
    'independent state fields'
  )
  await snapshot('application-detail')
  await click('.v3-sidebar a[href="/candidates"]')
  await h1('候选人管理')
  await input('搜索', '不存在的申请')
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  await check('document.body.innerText.includes("没有匹配的记录")', 'filtered empty')
  await snapshot('applications-filtered-empty')
  await button('清除筛选', 'document.querySelector(".v3-filters")')
  await check('!!document.querySelector("tbody tr")', 'filter cleared')
  failList = true
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  // Same-route navigation is a no-op; use a fresh query.
  await input('搜索', '虚构')
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  await check('document.body.innerText.includes("暂时无法查看记录")', 'list error')
  await snapshot('applications-error')
  failList = false
  await button('重新加载')
  await check('!!document.querySelector("tbody tr")', 'retry')

  // Fill a second page through the actual API; each application is independent.
  for (let n = 0; n < 21; n++) {
    const res = await fetch(app.url + '/api/v3/applications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        'Idempotency-Key': 'page-fixture-' + n
      },
      body: JSON.stringify({
        positionId: n === 0 ? 2 : 1,
        name: n === 0 ? '虚构申请人' : '分页申请 ' + n,
        owner: '演示 HR',
        appliedDate: '2026-11-09'
      })
    })
    assert.equal(res.status, 201)
  }
  await go('/candidates')
  await h1('候选人管理')
  await check('document.querySelectorAll("tbody tr").length===20', 'first bounded page')
  await button('下一页')
  await check('document.querySelectorAll("tbody tr").length===2', 'second bounded page')
  await snapshot('applications-page-2')
  await button('上一页')
  await check('document.querySelectorAll("tbody tr").length===20', 'previous page')
  await input('搜索', 'slow')
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  await check('document.body.innerText.includes("加载记录中")', 'loading state')
  await snapshot('applications-loading')
  await input('搜索', '分页申请')
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  await check('document.querySelectorAll("tbody tr").length===20', 'newer filter result')
  await sleep(1000)
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 20)
  await input('搜索', 'slow')
  await evaluate('document.querySelector(".v3-filters").requestSubmit()')
  await check('document.body.innerText.includes("加载记录中")', 'pending read before unmount')
  await click('.v3-sidebar a[href="/positions"]')
  await h1('职位管理')
  await sleep(1000)
  assert.equal(await evaluate('document.querySelector("h1").textContent'), '职位管理')
  await button('关闭', 'document.querySelector("tbody tr")')
  await check(
    'document.querySelector(".v3-editor")?.textContent.includes("21 条活跃申请")',
    'close risk count'
  )
  await save()
  await check('!document.querySelector(".v3-editor")', 'closed position')
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM candidates WHERE application_status='active'").get().n,
    22
  )
  await button('重新开放', 'document.querySelector("tbody tr")')
  await save()
  await check('!document.querySelector(".v3-editor")', 'reopened')
  await button('归档', 'document.querySelectorAll("tbody tr")[1]')
  await save()
  await check('!document.querySelector(".v3-editor")', 'archived')
  assert.ok(db.prepare('SELECT deleted_at FROM positions WHERE id=2').get().deleted_at !== null)
  await click('.v3-sidebar a[href="/candidates"]')
  await h1('候选人管理')
  await button('＋ 添加申请')
  await check('document.querySelectorAll(".v3-editor option").length===2', 'archived option absent')
  await input('应聘职位', '1')
  await input('姓名', '账号切换前的未决申请')
  await input('业务负责人', '演示 HR')
  await input('申请日期', '2026-11-09')
  drop = true
  await save()
  await check(
    'document.querySelector(".v3-editor")?.textContent.includes("提交结果尚未确定")',
    'second uncertain write'
  )
  await click('.v3-account button')
  await h1('登录招聘工作台')
  db.prepare(
    'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
  ).run('second-hr', bcrypt.hashSync(password, 10), '第二位演示 HR', 'hr', '', '', '')
  app.username = 'second-hr'
  await fill(app.password)
  await h1('工作台')
  assert.ok(
    await evaluate('document.querySelector(".v3-account").textContent.includes("第二位演示 HR")')
  )
  assert.ok(await evaluate('!document.querySelector(".v3-editor")'))
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM candidates WHERE name='账号切换前的未决申请'").get().n,
    1
  )

  db.prepare("UPDATE users SET role='viewer'").run()
  await evaluate('import("/src/api/request-v3.ts").then(m=>m.readV3("/positions")).catch(()=>null)')
  await h1('登录招聘工作台')
  await check('document.body.innerText.includes("当前账号没有招聘权限")', 'revocation')
  assert.equal(requests.filter((url) => /^\/api\/(?!v3\/)/.test(new URL(url).pathname)).length, 0)
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chromium: (await (await fetch('http://127.0.0.1:' + port + '/json/version')).json())
          .Browser,
        positionCreates: 2,
        applicationCreates: 23,
        idempotentReplay: true,
        operation403: true,
        roleRevocation: true,
        conflict409: true,
        draftRetention: true,
        filters: true,
        readRetry: true,
        v2Requests: 0,
        viewport: '1440x900',
        paginationRace: true,
        unmountRace: true,
        accountBoundary: true,
        closeReopenArchive: true,
        unverified: ['mobile hardware']
      },
      null,
      2
    )
  )
  console.log(
    'PASS real V3 CRUD, 403, 409, uncertain replay, identity outage draft, filter and retry; V2 requests=0'
  )
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
}
