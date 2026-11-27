import { showDetailTabForScope } from './v4-detail-controls.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { startDemoServer } from '../../server/index-demo-v3.js'
const output = process.argv[2]
if (!output) throw new Error('Provide a new evidence directory')
await mkdir(output, { recursive: false })
const profile = await mkdtemp(join(tmpdir(), 'hireflow-demo-chrome-'))
const password = 'a123456'
const running = await startDemoServer({ port: 0, staticDir: process.env.HIREFLOW_TEST_DEMO_STATIC })
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
let handledDialogs = 0
const shellChecks = []
const loginChecks = []
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
const key = async (name, code) => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: name,
      code: name,
      windowsVirtualKeyCode: code,
      text: type === 'keyDown' && name === 'Enter' ? String.fromCharCode(13) : undefined
    })
  }
}
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
async function loginViewportSnapshot(name) {
  await evaluate(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  )
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
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

// Run only when the caller requests the V4 shell acceptance checks.
async function verifyV4Shell(button, input) {
  const checkPage = (path, title) =>
    Promise.all([check('location.pathname === ' + JSON.stringify(path), path), h1(title)])
  const rails = [
    ['/dashboard', '招聘工作台'],
    ['/positions', '职位管理'],
    ['/candidates', '候选人管理'],
    ['/interviews', '面试管理'],
    ['/legacy-records', '旧版档案']
  ]
  const viewport = ([width, height]) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
  await viewport([1920, 1080])
  await check(
    'document.querySelector(".v4-shell").dataset.tier === "desktop"',
    'desktop rail ready'
  )
  for (const [path, title] of rails) {
    await click('.v3-sidebar a[href="' + path + '"]')
    await checkPage(path, title)
  }
  await click('.v3-account a[href="/profile"]')
  await checkPage('/profile', '个人中心')
  await check(
    'document.querySelectorAll(".v3-tab").length === 5 && !!document.querySelector(".v3-more")',
    'desktop tab overflow'
  )
  await evaluate('document.querySelector(".v3-more summary").focus()')
  await key('Enter', 13)
  await check('document.querySelector(".v3-more").open', 'open overflow with keyboard')
  const popup = await evaluate(
    'document.querySelector(".v3-more ul").getBoundingClientRect().toJSON()'
  )
  assert.ok(
    await evaluate(
      '!!document.elementFromPoint(' +
        (popup.left + 12) +
        ',' +
        (popup.top + 12) +
        ')?.closest(".v3-more ul")'
    )
  )
  await key('Tab', 9)
  await key('Escape', 27)
  await check(
    '!document.querySelector(".v3-more").open && document.activeElement.matches(".v3-more summary")',
    'restore overflow focus'
  )
  await evaluate('document.querySelector(".v3-tab.is-active button").focus()')
  await key('Enter', 13)
  await checkPage('/legacy-records', '旧版档案')
  await check(
    'document.activeElement.matches(".v3-tab.is-active a")',
    'closed active tab restores focus'
  )
  await go('/candidates?applicationStatus=active')
  await checkPage('/candidates', '候选人管理')
  await send('Page.reload')
  await check(
    'location.search === "?applicationStatus=active" && document.querySelectorAll(".v3-tab").length === 5',
    'refresh restores session, query and tabs'
  )
  await go('/v4-unknown-path')
  await checkPage('/dashboard', '招聘工作台')
  await check(
    'document.querySelector(".v4-demo-badge") && !document.querySelector(".v3-notice")',
    'demo safety notices'
  )
  await click('.v4-rail-toggle button')
  await check(
    '!document.querySelector(".v3-sidebar").classList.contains("is-collapsed")',
    'desktop expand'
  )
  await click('.v4-rail-toggle button')
  await check('document.querySelector(".v3-sidebar.is-collapsed")', 'desktop collapse')

  await click('.v3-sidebar a[href="/positions"]')
  await checkPage('/positions', '职位管理')
  await button('＋ 新建职位')
  await check('!!document.querySelector(".v3-editor")', 'draft editor')
  await input('职位名称', '虚构：壳层草稿检查')
  dialogMode = false
  const prior = handledDialogs
  await click('.v3-sidebar a[href="/dashboard"]')
  await check(
    'location.pathname === "/positions" && !!document.querySelector(".v3-editor")',
    'navigation cancel keeps draft'
  )
  await check(
    'document.querySelector("[aria-label=职位名称]").value === "虚构：壳层草稿检查"',
    'navigation preserved draft text'
  )
  await click('.v4-rail-account .v4-exit')
  await until(() => handledDialogs === prior + 2, 'guard confirmed both dialogs')
  await check(
    'location.pathname === "/positions" && document.querySelector("[aria-label=职位名称]").value === "虚构：壳层草稿检查"',
    'logout cancel keeps draft and session'
  )
  dialogMode = true
  await click('.v3-sidebar a[href="/dashboard"]')
  await checkPage('/dashboard', '招聘工作台')

  for (const [w, h, tier, limit] of [
    [1920, 1080, 'desktop', 5],
    [1440, 900, 'desktop', 5],
    [1366, 768, 'desktop', 5],
    [1024, 768, 'compact', 3],
    [390, 844, 'mobile', 1]
  ]) {
    await viewport([w, h])
    await check(
      'document.querySelector(".v4-shell").dataset.tier === ' + JSON.stringify(tier),
      tier
    )
    const metrics = await evaluate(
      '(() => {const m=document.querySelector("main.v3-content");const h=document.querySelector(".v3-header");return {w:innerWidth,h:innerHeight, documentWidth:document.documentElement.scrollWidth, documentHeight:document.documentElement.scrollHeight, contentWidth:m.clientWidth, contentScrollWidth:m.scrollWidth, headerBottom:h.getBoundingClientRect().bottom, contentTop:m.getBoundingClientRect().top, tabs:document.querySelectorAll(".v3-tab").length}})()'
    )
    assert.equal(metrics.w, w)
    assert.ok(metrics.documentWidth <= w + 1, JSON.stringify(metrics))
    assert.ok(metrics.documentHeight <= h + 1, JSON.stringify(metrics))
    assert.ok(metrics.contentScrollWidth <= metrics.contentWidth + 1, JSON.stringify(metrics))
    assert.ok(metrics.contentTop >= metrics.headerBottom)
    assert.equal(metrics.tabs, limit)
    await snapshot('v4-shell-' + w + 'x' + h)
    await evaluate('document.querySelector("main.v3-content").scrollTop = 100')
    const scrolled = await evaluate(
      '({top:document.querySelector("main.v3-content").scrollTop,header:document.querySelector(".v3-header").getBoundingClientRect().top,page:window.scrollY})'
    )
    assert.ok(scrolled.top > 0 && scrolled.header === 0 && scrolled.page === 0)
    await evaluate('document.querySelector("main.v3-content").scrollTop = 0')
    shellChecks.push({ viewport: [w, h], tier, ...metrics, scrolled })
  }
  await evaluate('document.querySelector("[aria-label=打开导航]").focus()')
  await key('Enter', 13)
  await check('document.querySelector("dialog.v3-drawer").open', 'drawer open')
  await key('Tab', 9)
  await check(
    'document.querySelector("dialog.v3-drawer").contains(document.activeElement)',
    'drawer Tab stays in dialog'
  )
  await snapshot('v4-shell-mobile-drawer')
  await key('Escape', 27)
  await check(
    '!document.querySelector("dialog.v3-drawer").open && document.activeElement.getAttribute("aria-label") === "打开导航"',
    'drawer Escape restores focus'
  )
  await key('Enter', 13)
  await viewport([1440, 900])
  await check(
    '!document.querySelector("dialog.v3-drawer").open && document.activeElement.getAttribute("aria-label") === "展开导航"',
    'resize restores rail focus'
  )
  await send('Emulation.clearDeviceMetricsOverride')
  const { windowId } = await send('Browser.getWindowForTarget')
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 900 } })
  await check('innerWidth > 1300', 'settled browser window width')
  const unzoomed = await evaluate('({width:innerWidth,dpr:devicePixelRatio})')
  const {
    targetInfo: { targetId: sourceTargetId }
  } = await send('Target.getTargetInfo')
  const { targetId } = await send('Target.createTarget', {
    url: 'chrome://settings/appearance',
    background: true
  })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
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
    }, 'browser settings native zoom API')
    await send(
      'Runtime.evaluate',
      { expression: 'chrome.settingsPrivate.setDefaultZoom(2)' },
      sessionId
    )
    await send('Target.activateTarget', { targetId: sourceTargetId })
    await send('Page.reload')
    await h1('招聘工作台')
    const observed = await evaluate('({width:innerWidth,dpr:devicePixelRatio})')
    console.log('Native zoom measurements', { unzoomed, observed })
    await check(
      'devicePixelRatio >= ' +
        unzoomed.dpr * 1.95 +
        ' && innerWidth <= ' +
        Math.ceil(unzoomed.width * 0.51),
      'native 200% zoom'
    )
    const zoomed = await evaluate(
      '({width:innerWidth,dpr:devicePixelRatio, pageWidth:document.documentElement.scrollWidth})'
    )
    assert.ok(zoomed.pageWidth <= zoomed.width + 1)
    // Native browser zoom changes the CSS-to-surface mapping. Use the viewport
    // capture without a CSS page clip, and verify visible content in the PNG.
    const captureNative = async (name) => {
      await check(
        'devicePixelRatio >= 1.95 && document.documentElement.scrollWidth <= innerWidth + 1',
        'native zoom layout ' + name
      )
      const png = await until(async () => {
        await evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
        )
        const { data } = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        })
        const hasInk = await evaluate(
          `(async () => {
          const url = 'data:image/png;base64,' + ${JSON.stringify(data)}
          const bitmap = await createImageBitmap(await (await fetch(url)).blob())
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = canvas.getContext('2d')
          context.drawImage(bitmap, 0, 0)
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
          bitmap.close()
          let darkPixels = 0
          for (let index = 0; index < pixels.length; index += 16) {
            if (Math.max(...pixels.subarray(index, index + 3)) < 130) darkPixels++
            if (darkPixels >= 100) return true
          }
          return false
        })()`
        )
        return hasInk ? data : null
      }, 'native zoom capture contains rendered foreground')
      await writeFile(join(output, name + '.png'), Buffer.from(png, 'base64'))
    }
    await captureNative('v4-shell-native-200')
    await go('/legacy-records')
    await h1('旧版档案')
    await check('!!document.querySelector(".legacy-list")', 'zoomed archive loaded')
    await captureNative('legacy-native-200')
    await go('/profile')
    await h1('个人中心')
    await check('!!document.querySelector(".profile-security")', 'zoomed profile loaded')
    await captureNative('profile-native-200')
    await click('.profile-exit')
    await h1('欢迎回来')
    await check(
      '!localStorage.getItem("hireflow_v3_session") && !sessionStorage.getItem("hireflow_v3_session_temp")',
      'profile logout clears the session'
    )
    await captureNative('login-native-200')
    await evaluate('document.querySelector(".login-submit").focus()')
    await captureNative('login-native-200-form')
    loginChecks.push({
      nativeZoom: 2,
      archive: true,
      profile: true,
      login: true,
      profileLogout: true
    })
    shellChecks.push({ nativeZoom: 2, unzoomed, zoomed })
  } finally {
    await send(
      'Runtime.evaluate',
      { expression: 'chrome.settingsPrivate?.setDefaultZoom(1)' },
      sessionId
    )
    await send('Target.closeTarget', { targetId })
  }
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
    if (m.method === 'Page.javascriptDialogOpening' && dialogMode !== null) {
      handledDialogs++
      void send('Page.handleJavaScriptDialog', { accept: dialogMode })
    }
  }
  await Promise.all([
    send('Page.enable'),
    send('Network.enable'),
    send('Runtime.enable'),
    width(1440)
  ])

  const loginPath = app.url + '/api/v3/auth/login'
  const loginCount = () => requests.filter((url) => url === loginPath).length
  await go('/profile')
  await h1('欢迎回来')
  await check(
    '!document.getElementById("v3-username").value && !document.getElementById("v3-password").value',
    'Demo inputs are initially empty'
  )
  await check(
    'document.querySelector(".login-demo").textContent.includes("a123456")',
    'public password shown'
  )
  await check('document.body.innerText.includes("请勿输入真实个人信息")', 'privacy notice')
  for (const [w, height] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [390, 844]
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    await check(
      `innerWidth === ${w} && document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector(".login-hero").naturalWidth > 0`,
      'login layout at ' + w
    )
    await loginViewportSnapshot('login-' + w + 'x' + height)
    loginChecks.push({ viewport: [w, height], pageWidthOverflow: false })
  }
  await width(1440)
  await snapshot('demo-login')
  await evaluate('document.querySelector("form").requestSubmit()')
  await check(
    'document.querySelector("#login-error")?.textContent.includes("请输入账号") && document.activeElement.id === "v3-username"',
    'empty account validation and focus'
  )
  await key('Tab', 9)
  await check(
    'document.activeElement.id === "v3-password"',
    'Tab advances from account to password'
  )
  assert.equal(loginCount(), 0)
  await click('.login-demo button')
  await check(
    'document.getElementById("v3-username").value === "demo_admin" && document.getElementById("v3-password").value === "a123456"',
    'Demo fill sets both fields'
  )
  assert.equal(loginCount(), 0)
  await fill('invalid-fixture-password')
  await check(
    'document.querySelector("#login-error")?.textContent.includes("账号或密码不正确") && document.getElementById("v3-username").value === "demo_admin" && !document.getElementById("v3-password").value && document.activeElement.id === "v3-password"',
    '401 preserves account, clears password and returns focus'
  )
  await snapshot('login-auth-error')
  await click('.login-demo button')
  await click('.login-content input[type=checkbox]')
  await evaluate(
    '(() => { const form = document.querySelector("form"); form.requestSubmit(); form.requestSubmit() })()'
  )
  await check('location.pathname === "/profile"', 'safe return to protected profile')
  await h1('个人中心')
  assert.equal(loginCount(), 2)
  await check('!!localStorage.getItem("hireflow_v3_session")', 'remembered token stored')
  await check(
    'document.querySelector(".v4-profile").innerText.includes("招聘管理员（演示）") && !document.querySelector(".v4-profile input")',
    'profile reads current identity'
  )
  await snapshot('profile-readonly')
  await check(
    '[...document.querySelectorAll(".profile-edit, .profile-security button:not(.profile-exit)")].every(button=>button.disabled) && document.querySelector("#profile-availability").textContent.includes("共享演示账号")',
    'Demo account writes are disabled'
  )
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  })
  await loginViewportSnapshot('profile-readonly-1920')
  await width(1440)
  await send('Page.reload')
  await h1('个人中心')
  await check(
    'document.querySelector(".profile-security").innerText.includes("当前会话已通过身份验证")',
    'profile session restored'
  )
  await go('/legacy-records')
  await h1('旧版档案')
  await check(
    'document.querySelector(".legacy-list [data-state=empty]")?.textContent.includes("暂无旧版档案")',
    'real Demo archive empty state'
  )
  await snapshot('legacy-demo-empty')
  loginChecks.push({
    empty: true,
    fillWithoutLogin: true,
    wrongPassword: true,
    duplicateSubmitBlocked: true,
    remembered: true,
    safeReturn: true,
    refresh: true,
    profileReadonly: true,
    legacyInitiallyEmpty: true
  })
  await go('/dashboard')
  await h1('招聘工作台')
  await check('document.body.innerText.includes("招聘管理员（演示）")', 'identity')
  await snapshot('demo-dashboard')
  const button = async (text, scope = 'document') => {
    await showDetailTabForScope(evaluate, scope)
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
    const path = '/candidates/' + id
    if ((await evaluate('location.pathname')) !== path) await go(path)
    await h1('申请详情')
    await check(
      'document.querySelector(".v4-detail-identity")?.textContent.includes("申请 #' + id + '")',
      'detail ID'
    )
    await check(
      '!!document.querySelector(".v3-offer")&&!document.querySelector(".v3-offer-loading")&&!document.querySelector(".v3-feedback-loading")',
      'business panels read'
    )
  }
  const readyButton = async (text, scope = 'document') => {
    await showDetailTabForScope(evaluate, scope)
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
  const meeting = async (id, action, mid, time, reason) => {
    await detail(id)
    const scope =
      action === '安排面试'
        ? 'document.querySelector(".v3-interviews")'
        : 'document.querySelector("[data-interview-id=\\"' + mid + '\\"]")'
    await readyButton(action, scope)
    await check('!!document.querySelector(".v3-interview-editor")', 'interview editor')
    if (time) await input('预约开始时间', time)
    if (action === '安排面试') await input('专业面试官姓名', '虚构专业面试官')
    if (reason) await input('取消原因', reason)
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
  assert.equal(c(id).position_id, job)
  const decisions = () =>
    db.prepare("SELECT * FROM business_events WHERE candidate_id=? AND event_type='stage_advanced' ORDER BY id").all(id)
  const totals = () =>
    db.prepare("SELECT count(*) AS applications, sum(outcome IS 'hired') AS hired FROM candidates").get()
  const interview = (mid) => db.prepare('SELECT * FROM interviews WHERE id=?').get(mid)
  await advance(id)
  stages.push({ stage: c(id).stage })
  const first = await meeting(id, '安排面试', null, '2026-11-17T09:00:00')
  const beforeReschedule = interview(first)
  assert.equal(await meeting(id, '改期', first, '2026-11-17T09:30:00'), first)
  assert.equal(interview(first).scheduled_at, Date.parse('2026-11-17T09:30:00+08:00'))
  assert.notEqual(interview(first).scheduled_at, beforeReschedule.scheduled_at)
  await meeting(id, '确认完成', first)
  assert.equal(c(id).stage, 'first_interview')
  assert.equal(interview(first).status, 'completed')
  assert.equal(decisions().length, 1)
  await feedback(id, first, '填写面评', '虚构初面：依据完整，建议复面')
  assert.equal(c(id).stage, 'first_interview')
  assert.equal(decisions().length, 1)
  await advance(id)
  assert.equal(c(id).stage, 'second_interview')
  const second = await meeting(id, '安排面试', null, '2026-11-17T10:00:00')
  await meeting(id, '确认完成', second)
  const waiverReason = '虚构复面缺评：HR 核对后说明原因推进'
  await advance(id, waiverReason)
  const waiver = decisions().at(-1)
  const missing = () =>
    db.prepare('SELECT interview_id,stage_scope FROM advancement_missing_feedback WHERE event_id=?').get(waiver.id)
  assert.deepEqual({ ...missing() }, { interview_id: second, stage_scope: 'second_interview' })
  assert.equal(waiver.reason, waiverReason)
  assert.equal(c(id).offer_status, 'preparing')
  await offer(id, '登记 Offer 已发送')
  assert.equal(c(id).offer_status, 'sent')
  await offer(id, '登记候选人接受 Offer')
  assert.equal(c(id).offer_status, 'accepted')
  assert.equal(c(id).application_status, 'active')
  assert.equal(c(id).outcome, null)
  stages.push({ offer: 'accepted', status: c(id).application_status, outcome: c(id).outcome })
  await snapshot('demo-offer-accepted')
  await feedback(id, second, '补录历史面评', '虚构复面：晋级后补录原轮次评价')
  const supplement = db.prepare("SELECT * FROM business_events WHERE interview_id=? AND event_type='feedback_supplemented'").get(second)
  const submitted = db.prepare('SELECT * FROM feedback WHERE interview_id=?').get(second)
  assert.equal(submitted.submitted_at, supplement.occurred_at)
  assert.ok(submitted.submitted_at >= waiver.occurred_at)
  assert.equal(submitted.recorded_by_user_id, waiver.actor_user_id)
  assert.equal(submitted.reviewer_name, '虚构专业评价人')
  assert.deepEqual(decisions().at(-1), waiver)
  assert.equal(missing().interview_id, second)
  assert.equal(c(id).application_status, 'active')
  const beforeHire = totals()
  await offer(id, 'HR 确认录用', '虚构演示：HR确认录用')
  assert.deepEqual([c(id).stage, c(id).application_status, c(id).offer_status, c(id).outcome], ['offer', 'closed', 'accepted', 'hired'])
  await button('真实历史')
  await check('document.querySelector(".v4-application-history")?.textContent.includes("录用")', 'hiring history in UI')
  await snapshot('demo-e2e-01-history')
  const auth = await fetch(loginPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: app.username, password: app.password })
  })
  assert.equal(auth.status, 200)
  const { token } = await auth.json()
  const apiRead = async (path) => {
    const response = await fetch(app.url + '/api/v3' + path, {
      headers: { Authorization: 'Bearer ' + token }
    })
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const summary = await apiRead('/dashboard/summary')
  assert.equal(summary.applicationTotals.hired, beforeHire.hired + 1)
  assert.equal(summary.applicationTotals.total, totals().applications)
  const end = await apiRead('/applications/' + id + '/offer')
  assert.deepEqual([end.stage, end.applicationStatus, end.offerStatus, end.outcome], ['offer', 'closed', 'accepted', 'hired'])
  const actualWaiver = (await apiRead('/applications/' + id + '/advancement/history')).find((event) => event.eventId === waiver.id)
  assert.deepEqual(actualWaiver.missingInterviews, [{ interviewId: second, stageScope: 'second_interview' }])
  assert.equal(actualWaiver.actorUserId, waiver.actor_user_id)
  assert.equal(actualWaiver.reason, waiverReason)
  const e2e01 = { job, id, first, second, waiverEventId: waiver.id, supplementEventId: supplement.id, supplementTime: submitted.submitted_at, actorUserId: waiver.actor_user_id, final: end, dashboard: summary.applicationTotals }
  stages.push({ outcome: c(id).outcome })
  await snapshot('demo-hired')

  await go('/positions')
  await h1('职位管理')
  await newPosition('[虚构演示] 浏览器完整流程')
  const sameNameJob = db.prepare('SELECT max(id) AS id FROM positions').get().id
  assert.notEqual(sameNameJob, job)
  const withdrawn = await application(sameNameJob, '[虚构演示] 同名职位独立申请')
  const rejected = await application(job, '[虚构演示] 同名职位独立申请')
  const declined = await application(sameNameJob, '[虚构演示] Offer 拒绝路径')
  const recordsFor = (positionId) =>
    db.prepare('SELECT COUNT(*) AS n FROM candidates WHERE position_id=?').get(positionId).n
  for (const pos of [job, sameNameJob]) {
    assert.equal((await apiRead('/positions/' + pos)).applicationRecords, recordsFor(pos))
    assert.equal(recordsFor(pos), 2)
  }
  await advance(withdrawn)
  const cancelled = await meeting(withdrawn, '安排面试', null, '2026-11-17T11:00:00')
  await meeting(withdrawn, '取消面试', cancelled, null, '虚构日程取消原因')
  assert.equal(interview(cancelled).status, 'cancelled')
  assert.equal(c(withdrawn).stage, 'first_interview')
  await advance(withdrawn, '虚构：记录跳过本轮评估的真实理由')
  await offer(withdrawn, '结束招聘', '虚构：候选人主动退出', 'candidate_withdrew')
  await advance(rejected)
  await offer(rejected, '结束招聘', '虚构：企业淘汰', 'company_rejected')
  await advance(declined)
  await advance(declined, '虚构：第一轮评估例外说明')
  await advance(declined, '虚构：第二轮评估例外说明')
  await offer(declined, '登记 Offer 已发送')
  await offer(declined, '登记候选人拒绝 Offer', '虚构：候选人拒绝 Offer')
  const e2e02 = []
  for (const [record, stage, outcome, offerStatus] of [
    [withdrawn, 'second_interview', 'candidate_withdrew', null],
    [rejected, 'first_interview', 'company_rejected', null],
    [declined, 'offer', 'offer_declined', 'declined']
  ]) {
    const state = await apiRead('/applications/' + record + '/offer')
    assert.deepEqual([state.stage, state.applicationStatus, state.outcome, state.offerStatus], [stage, 'closed', outcome, offerStatus])
    assert.deepEqual([c(record).stage, c(record).application_status, c(record).outcome, c(record).offer_status], [stage, 'closed', outcome, offerStatus])
    const event = db.prepare('SELECT id,event_type,actor_user_id,reason FROM business_events WHERE candidate_id=? ORDER BY id DESC LIMIT 1').get(record)
    assert.equal(event.event_type, record === declined ? 'offer_declined' : 'application_closed')
    assert.ok(event.reason)
    e2e02.push({ record, state, event })
  }
  await snapshot('demo-e2e-02-offer-declined')
  const sameNameCounts = [recordsFor(job), recordsFor(sameNameJob)]
  const immutableHistory = db.prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id').all(id)
  await detail(id)
  await check(
    '!!document.querySelector(".v4-detail") && ![...document.querySelectorAll(".v4-detail button")].some(button => /删除(申请|面试)/.test(button.textContent))',
    'no destructive application or interview control'
  )
  const deleteResponses = []
  for (const path of ['/applications/' + id, '/applications/' + id + '/interviews/' + first]) {
    const response = await fetch(app.url + '/api/v3' + path, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    })
    assert.equal(response.status, 404, path)
    deleteResponses.push(response.status)
  }
  assert.equal(interview(first).status, 'completed')
  assert.equal(c(id).outcome, 'hired')
  assert.deepEqual(db.prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id').all(id), immutableHistory)

  await go('/positions/' + job)
  await button('编辑职位')
  const renamed = '[虚构演示] 浏览器更名后职位'
  await input('职位名称', renamed)
  await save()
  await h1(renamed)
  assert.equal((await apiRead('/positions/' + job)).title, renamed)
  assert.equal((await apiRead('/positions/' + sameNameJob)).title, '[虚构演示] 浏览器完整流程')
  assert.equal(recordsFor(job), sameNameCounts[0])
  assert.equal(c(id).position_id, job)
  assert.equal(interview(first).candidate_id, id)
  assert.deepEqual(db.prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id').all(id), immutableHistory)
  await detail(id)
  await check('document.querySelector(".v4-detail-heading-row p")?.textContent.includes(' + JSON.stringify(renamed) + ')', 'renamed position shown on original application')
  const active = await application(job, '[虚构演示] 职位关闭时仍进行中的申请')
  const openPositionMenu = async (action) => {
    await go('/positions?q=' + encodeURIComponent(renamed))
    await h1('职位管理')
    const trigger = `button[aria-label="职位 #${job} 的更多操作"]`
    await check('!!document.querySelector(' + JSON.stringify(trigger) + ')', 'matching position menu')
    await click(trigger)
    await readyButton(action, 'document.querySelector(".v4-position-menu")')
  }
  await openPositionMenu('关闭')
  await check('document.querySelector(".v3-editor")?.textContent.includes("关闭职位不会结束已有申请")', 'linked applications warning')
  await snapshot('position-close-with-active-application')
  await save()
  await check('!document.querySelector(".v3-editor")', 'position closed')
  assert.equal((await apiRead('/positions/' + job)).status, 'closed')
  assert.equal(c(active).application_status, 'active')
  await go('/candidates')
  await readyButton('＋ 添加申请')
  await check('!!document.querySelector("[aria-label=应聘职位]")', 'position options loaded')
  assert.equal(await evaluate(`Array.from(document.querySelector("[aria-label=应聘职位]").options).some(option => option.value === "${job}")`), false)
  await button('取消', 'document.querySelector(".v3-editor")')
  await openPositionMenu('归档')
  await check('document.querySelector(".v3-editor")?.textContent.includes("现有申请和历史关联会保留")', 'archive protects history')
  await save()
  await check('!document.querySelector(".v3-editor")', 'linked position archived')
  assert.ok((await apiRead('/positions/' + job)).deletedAt !== null)
  assert.equal(c(active).position_id, job)
  assert.equal(c(active).application_status, 'active')
  assert.deepEqual(db.prepare('SELECT * FROM business_events WHERE candidate_id=? ORDER BY id').all(id), immutableHistory)
  const frozenGuards = {
    deleteResponses,
    immutableEventCount: immutableHistory.length,
    renamePreservedRelations: true,
    activeApplicationAfterPositionClosureAndArchive: active
  }
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
  if (process.argv.includes('--v4-shell')) {
    await verifyV4Shell(button, input)
  }
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
        e2e01,
        e2e02: { positions: [job, sameNameJob], recordsPerPosition: sameNameCounts, cases: e2e02 },
        frozenGuards,
        shellChecks,
        events,
        receipts,
        v2Requests: v2.length,
        externalApiRequests: external.length,
        browserExceptions,
        consoleErrors,
        networkFailures,
        loginChecks,
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
