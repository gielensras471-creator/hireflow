import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initializeFirstHr, initializeV3File } from '../../server/db/persistent-v3.js'
import { startV3Server } from '../../server/index-v3.js'
import { startDemoServer } from '../../server/index-demo-v3.js'

const [output, formalDir, demoDir] = process.argv.slice(2)
assert.ok(output && formalDir && demoDir)
await mkdir(output)
const data = await mkdtemp(join(tmpdir(), 'hf-account-browser-db-'))
const profile = await mkdtemp(join(tmpdir(), 'hf-account-browser-chrome-'))
const database = join(data, 'account-fixture.db')
const credential = () => randomBytes(18).toString('base64url')
const username = 'fictional-browser-hr'
const oldPassword = credential()
const newPassword = credential()
await initializeV3File(data, database, 'isolated browser account fixture')
initializeFirstHr(data, database, { username, name: '虚构浏览器用户', password: oldPassword })
const port = await new Promise((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolve(port))
  })
})
const formal = await startV3Server({
  NODE_ENV: 'production',
  V3_DATA_ROOT: data,
  V3_DATABASE_PATH: database,
  V3_JWT_SECRET: randomBytes(48).toString('hex'),
  V3_PORT: String(port),
  V3_STATIC_DIR: resolve(formalDir)
})
const demo = await startDemoServer({ port: 0, staticDir: demoDir })
const base = 'http://127.0.0.1:' + port
const demoBase = 'http://127.0.0.1:' + demo.server.address().port
const chrome = spawn(
  process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--no-first-run',
    '--disable-background-networking',
    '--disable-sync',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
  ],
  { windowsHide: true, stdio: 'ignore' }
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function wait(fn, description) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      if (await fn()) return
    } catch {
      /* A navigation may temporarily replace the document. */
    }
    await sleep(100)
  }
  throw new Error(description)
}
let ws
const pending = new Map()
const handlers = new Map()
let id = 0
function send(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject })
    ws.send(JSON.stringify({ id: key, method, params, sessionId }))
  })
}
async function browserPage(browserContextId) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const command = (method, params) => send(method, params, sessionId)
  await command('Page.enable')
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true
    })
    if (result.exceptionDetails) throw new Error('Chrome evaluation failed')
    return result.result?.value
  }
  const check = (expression, label) => wait(() => evaluate(expression), label)
  const click = async (selector) => {
    await check(
      `document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`,
      'clickable account control'
    )
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }
  const fill = async (selector, value) => {
    await check(`!!document.querySelector(${JSON.stringify(selector)})`, 'account input visible')
    await evaluate(
      `(() => {const e=document.querySelector(${JSON.stringify(selector)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true}))})()`
    )
  }
  const snap = async (file) => {
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
    )
    const { data } = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false
    })
    assert.ok(data.length > 10000)
    await writeFile(join(output, file + '.png'), Buffer.from(data, 'base64'))
  }
  const viewport = (width, height) =>
    command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
  return {
    sessionId,
    targetId,
    command,
    evaluate,
    check,
    click,
    fill,
    snap,
    viewport,
    go: (url) => command('Page.navigate', { url })
  }
}
const selector = '.profile-preview .profile-save'
const pressSave = (page) => page.click(selector)
async function login(page, password) {
  await page.fill('#v3-username', username)
  await page.fill('#v3-password', password)
  await page.click('.login-submit')
}
try {
  let debugPort
  await wait(
    async () =>
      (debugPort = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]),
    'Chrome port'
  )
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json()
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const task = pending.get(message.id)
    if (task) {
      pending.delete(message.id)
      if (message.error) task.reject(new Error('Chrome protocol error'))
      else task.resolve(message.result)
    }
    handlers.get(message.sessionId)?.(message)
  }
  const first = await browserPage()
  const { browserContextId } = await send('Target.createBrowserContext', {})
  const second = await browserPage(browserContextId)
  await first.viewport(1920, 1080)
  await first.go(base + '/profile')
  await second.go(base + '/profile')
  await login(first, oldPassword)
  await login(second, oldPassword)
  await first.check('!!document.querySelector(".profile-summary")', 'first formal profile')
  await second.check(
    '!!document.querySelector(".profile-summary")',
    'independent second formal profile'
  )
  const candidateTable = '.profile-preferences .profile-row:first-of-type button:last-child'
  const tableSelected = `document.querySelector(${JSON.stringify(candidateTable)})?.getAttribute('aria-pressed') === 'true'`
  await first.click(candidateTable)
  await first.check(tableSelected, 'formal preference saved')
  await second.check(`!!document.querySelector(${JSON.stringify(candidateTable)}) && !(${tableSelected})`, 'independent browser retains its default')
  await first.click('.profile-edit')
  await first.check(
    'document.activeElement.id === "profile-preview-name"',
    'name dialog initial focus'
  )
  await first.fill('#profile-preview-name', '应丢弃的虚构草稿')
  let confirmed = 0
  handlers.set(first.sessionId, (message) => {
    if (message.method === 'Page.javascriptDialogOpening') {
      confirmed++
      void first.command('Page.handleJavaScriptDialog', { accept: confirmed === 2 })
    }
  })
  const cancel = '.profile-preview .el-dialog__footer button:not(.profile-save)'
  await first.click(cancel)
  await first.check(
    'document.querySelector("#profile-preview-name")?.value === "应丢弃的虚构草稿"',
    'cancel confirmation preserves draft'
  )
  await first.click(cancel)
  await first.check(
    '!document.querySelector(".profile-preview") && document.activeElement.classList.contains("profile-edit")',
    'accepted discard returns focus'
  )
  assert.equal(confirmed, 2)
  handlers.delete(first.sessionId)
  await first.click('.profile-edit')
  await first.fill('#profile-preview-name', '虚构账号新名称')
  await pressSave(first)
  await first.check(
    'document.querySelector(".profile-summary h2").textContent === "虚构账号新名称" && document.querySelector(".v3-account").innerText.includes("虚构账号新名称")',
    'new name in profile and header'
  )
  await first.command('Page.reload')
  await first.check(
    'document.querySelector(".profile-summary h2").textContent === "虚构账号新名称"',
    'name survives reload'
  )
  await first.check(tableSelected, 'preference survives name change')
  await first.snap('formal-profile-renamed')
  await first.click('.profile-security button:not(.profile-exit)')
  await first.check(
    'document.activeElement.id === "profile-current-password"',
    'password dialog initial focus'
  )
  await first.snap('formal-password-desktop')
  await first.viewport(390, 844)
  await first.check(
    'document.querySelector(".profile-preview").getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth',
    'narrow profile dialog fits'
  )
  await first.snap('formal-password-390')
  await pressSave(first)
  await first.check(
    'document.querySelector("#profile-edit-error")?.textContent.includes("两次新密码一致")',
    'password client validation'
  )

  let interrupted = 0
  handlers.set(first.sessionId, (message) => {
    if (message.method === 'Fetch.requestPaused') {
      interrupted++
      void first.command('Fetch.failRequest', {
        requestId: message.params.requestId,
        errorReason: 'Failed'
      })
    }
  })
  await first.command('Fetch.enable', { patterns: [{ urlPattern: '*/api/v3/auth/me/password' }] })
  const fillChange = async () => {
    await first.fill('#profile-current-password', oldPassword)
    await first.fill('#profile-new-password', newPassword)
    await first.fill('#profile-confirm-password', newPassword)
    await pressSave(first)
  }
  await fillChange()
  await first.check(
    'document.querySelector(".login-account-notice")?.textContent.includes("尚未确认")',
    'unconfirmed write requires sign-in'
  )
  assert.equal(interrupted, 1)
  await first.command('Fetch.disable')
  handlers.delete(first.sessionId)
  await first.go(base + '/profile')
  await login(first, oldPassword)
  await first.check(
    '!!document.querySelector(".profile-summary")',
    'old password after simulated interruption'
  )
  await first.viewport(1920, 1080)
  await first.click('.profile-security button:not(.profile-exit)')
  await fillChange()
  await first.check(
    'document.querySelector(".login-account-notice")?.textContent.includes("密码已修改") && !localStorage.getItem("hireflow_v3_session") && !sessionStorage.getItem("hireflow_v3_session_temp") && !document.querySelector(".profile-preview")',
    'password change clears session and form'
  )
  await first.snap('formal-password-reauth')
  await second.command('Page.reload')
  await second.check(
    'location.pathname === "/login" && !sessionStorage.getItem("hireflow_v3_session_temp")',
    'independent browser session revoked'
  )
  await first.go(base + '/profile')
  await login(first, oldPassword)
  await first.check(
    'document.querySelector("#login-error")?.textContent.includes("账号或密码不正确") && !document.querySelector("#v3-password").value',
    'old password rejected'
  )
  await login(first, newPassword)
  await first.check(
    'document.querySelector(".profile-summary h2")?.textContent === "虚构账号新名称"',
    'new password accepted'
  )
  await first.check(tableSelected, 'preference survives password change and reauthentication')

  await first.command('Emulation.clearDeviceMetricsOverride')
  const { windowId } = await send('Browser.getWindowForTarget', { targetId: first.targetId })
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 900 } })
  const settings = await browserPage()
  await settings.go('chrome://settings/appearance')
  await settings.check(
    'typeof chrome.settingsPrivate?.setDefaultZoom === "function"',
    'native zoom setting'
  )
  await settings.evaluate('chrome.settingsPrivate.setDefaultZoom(2)')
  await send('Target.activateTarget', { targetId: first.targetId })
  await first.command('Page.reload')
  await first.check(
    'devicePixelRatio === 2 && innerWidth < 750 && !!document.querySelector(".profile-summary")',
    'native 200%'
  )
  await first.click('.profile-security button:not(.profile-exit)')
  await first.check(
    'document.activeElement.id === "profile-current-password" && getComputedStyle(document.querySelector(".el-overlay:has(.profile-preview)")).opacity === "1" && document.querySelector(".profile-preview").getBoundingClientRect().right <= innerWidth',
    '200% dialog fits'
  )
  await first.snap('formal-password-native-200')
  await first.evaluate('document.querySelector(".profile-save").scrollIntoView({block:"nearest"})')
  await first.check(
    'document.querySelector(".profile-save").getBoundingClientRect().bottom <= innerHeight',
    '200% save is reachable'
  )
  await first.snap('formal-password-native-200-actions')
  await settings.evaluate('chrome.settingsPrivate.setDefaultZoom(1)')
  await send('Target.closeTarget', { targetId: settings.targetId })

  await second.viewport(1920, 1080)
  await second.go(demoBase + '/profile')
  await second.click('.login-demo button')
  await second.click('.login-submit')
  await second.check(
    'document.querySelector(".profile-edit")?.disabled && document.querySelector(".profile-security button:not(.profile-exit)")?.disabled',
    'Demo controls disabled'
  )
  await second.snap('demo-profile-disabled')
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      {
        chrome: version.Browser,
        formalNamePersistence: true,
        realHeaderUpdate: true,
        clientValidation: true,
        reauth: true,
        independentSessionRevoked: true,
        oldPasswordRejected: true,
        newPasswordWorks: true,
        preferenceSurvivedNameAndPassword: true,
        ambiguousRequest: 'one request, result unknown, login required',
        dialogFocus: true,
        draftCancelAndFocusReturn: true,
        desktop: true,
        mobile390: true,
        native200: true,
        demoDisabled: true
      },
      null,
      2
    )
  )
} finally {
  ws?.close()
  chrome.kill()
  await Promise.all([formal.close(), demo.close()])
}
