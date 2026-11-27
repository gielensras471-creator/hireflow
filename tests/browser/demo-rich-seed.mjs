import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url, output] = process.argv.slice(2)
assert.match(url ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
assert.ok(output)
const app = { url }
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(tmpdir(), 'hireflow-rich-chrome-'))
const chrome = spawn(
  process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    ...(process.argv.includes('--headed') ? ['--start-maximized'] : ['--headless=new']),
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
const pending = new Map()
let seq = 0
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

const button = async (label) => {
  const expression = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(${JSON.stringify(label)}))`
  await check('Boolean(' + expression + ')', label)
  await evaluate(expression + '.click()')
}
const snap = async (name, clip) => {
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const png = await until(async () => {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      ...(clip && { clip: { ...clip, scale: 1 } })
    })
    const captured = Buffer.from(data, 'base64')
    return captured.length > (clip ? 500 : 12000) ? captured : null
  }, 'screenshot ' + name)
  await writeFile(join(output, name + '.png'), png)
}
try {
  const port = await until(
    async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0],
    'DevTools'
  )
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = ({ data }) => {
    const result = JSON.parse(data)
    const task = pending.get(result.id)
    pending.delete(result.id)
    if (result.error) task?.reject(new Error(result.error.message))
    else task?.resolve(result.result)
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  })
  await go('/dashboard')
  await h1('欢迎回来')
  const loginGeometry = await evaluate(`(() => {
    const { width, height } = document.querySelector('.login-frame').getBoundingClientRect()
    return { width, height, formWidth: document.querySelector('.login-content').getBoundingClientRect().width }
  })()`)
  assert.deepEqual(loginGeometry, { width: 1275, height: 782, formWidth: 501.5 })
  await snap('login')
  await button('一键填入')
  await button('登录工作台')
  await h1('招聘工作台')
  await check(
    'document.querySelectorAll(".v4-dash-value").length===7 && document.querySelectorAll(".v4-dash-job").length===3 && document.querySelectorAll(".v4-dash-progress dl dd").length===5',
    'Dashboard ready'
  )
  assert.deepEqual(
    await evaluate('[...document.querySelectorAll(".v4-dash-value")].map(e=>+e.textContent)'),
    [18, 25, 32, 39, 26, 33, 27]
  )
  await snap('dashboard')
  await go('/positions')
  await h1('职位管理')
  await check('document.querySelectorAll(".v4-position-card").length >= 8', 'position cards')
  await snap('positions')
  await go('/candidates')
  await h1('候选人管理')
  await check(
    'document.querySelectorAll("[data-stage]").length===4 && [...document.querySelectorAll("[data-stage]")].every(e=>e.querySelector("a"))',
    'four populated columns'
  )
  await snap('candidates-board')
  await click('.v4-view-switch button:nth-child(2)')
  await check(
    'document.querySelectorAll("[data-application-link]").length===20',
    'candidate table page size'
  )
  await snap('candidates-table')
  const auth = await fetch(url + '/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo_admin', password: 'a123456' })
  })
  const { token } = await auth.json()
  const get = async (path) => {
    const response = await fetch(url + '/api/v3' + path, {
      headers: { Authorization: 'Bearer ' + token }
    })
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const offers = await get('/applications?stage=offer&limit=100')
  const interviewList = await get('/interviews?status=completed&limit=100')
  const counts = new Map()
  for (const item of interviewList.items)
    counts.set(item.applicationId, (counts.get(item.applicationId) ?? 0) + 1)
  const detail =
    offers.items.find((row) => row.outcome === 'hired' && counts.get(row.id) >= 2) ??
    offers.items.find((row) => row.outcome === 'hired')
  assert.ok(detail)
  await go('/candidates/' + detail.id)
  await h1('申请详情')
  await check('!!document.querySelector("[data-detail-tab=interviews]")', 'detail ready')
  await click('[data-detail-tab=interviews]')
  await check('!!document.querySelector("[data-interview-id]")', 'interviews in detail')
  await snap('candidate-interviews')
  await click('[data-detail-tab=offer]')
  await check(
    'document.querySelector(".v4-offer-closure")?.innerText.includes("录用")',
    'Offer detail'
  )
  await snap('candidate-offer')
  await click('[data-detail-tab=history]')
  await check(
    'document.querySelector(".v4-history")?.innerText.includes("Offer") || document.querySelector("#v4-detail-panel-history")?.innerText.includes("Offer")',
    'history ready'
  )
  await snap('candidate-history')
  await go('/interviews')
  await h1('面试管理')
  await check('document.querySelectorAll(".v4-week [data-interview-id]").length>0', 'weekly events')
  assert.ok(
    await evaluate(
      'document.querySelector(".v4-week-head").innerText.includes("北京时间") && document.querySelector(".v4-week-head").innerText.includes("UTC+8")'
    )
  )
  await check('!document.querySelector(".v4-week-message")', 'complete week')
  await snap('calendar-week')
  const weekCards = await evaluate(`[...document.querySelectorAll('.v4-week-event')].map(card => ({
    id: card.dataset.interviewId,
    status: card.dataset.status,
    count: Number(card.querySelector('small')?.textContent.match(/(\\d+) 场面试/)?.[1] || 1)
  }))`)
  const examples = [
    ...['scheduled', 'completed', 'cancelled', 'due'].map((status) => [
      status,
      weekCards.find((card) => card.status === status)
    ]),
    ...[2, 3, 4].map((count) => ['group-' + count, weekCards.find((card) => card.count === count)])
  ]
  for (const [name, card] of examples) {
    if (!card) continue
    const selector = '.v4-week-event[data-interview-id="' + card.id + '"]'
    const clip = await evaluate(`(() => {
      const card = document.querySelector(${JSON.stringify(selector)})
      card.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = card.getBoundingClientRect()
      return {x: Math.floor(r.x)-3,y: Math.floor(r.y)-3,width: Math.ceil(r.width)+6,height: Math.ceil(r.height)+10}
    })()`)
    await snap('card-' + name, clip)
  }
  const aggregate =
    weekCards.find((card) => card.count === 3) ?? weekCards.find((card) => card.count > 1)
  if (aggregate) {
    await button('定位 08:00')
    await click('.v4-week-event[data-interview-id="' + aggregate.id + '"]')
    await check(
      'document.querySelectorAll(".v4-interview-members button").length === ' + aggregate.count,
      'rich aggregation'
    )
    await snap('calendar-members')
    await click('[aria-label="关闭面试侧面板"]')
  }
  await click('.v4-week-header .v4-interview-switch button:first-child')
  await check(
    'document.querySelector(".v4-week[data-mode=day] [data-interview-id]")',
    'daily events'
  )
  await snap('calendar-day')
  await click('.v4-week-header .v4-interview-switch button:last-child')
  await check('document.querySelectorAll(".v4-month-event").length>0', 'monthly events')
  await snap('calendar-month')
  await go('/legacy-records')
  await h1('旧版档案')
  await check(
    'new Set([...document.querySelectorAll("[data-mapping]")].map(e=>e.dataset.mapping)).size>=3',
    'legacy mapping variants'
  )
  await snap('legacy')
  await click('.legacy-list tbody a')
  await check('!!document.querySelector(".legacy-detail")', 'legacy detail')
  await snap('legacy-detail')
  await go('/profile')
  await h1('个人中心')
  await check('!!document.querySelector(".profile-summary")', 'profile identity')
  await snap('profile')
  if (process.argv.includes('--preferences-fullscreen')) {
    const segments = '.profile-preferences .profile-segments'
    await click(segments + ':first-of-type button:last-child')
    await click('.profile-preferences .profile-row:last-of-type button:last-child')
    await check(
      'document.querySelector(".profile-preferences [role=status]")?.textContent.includes("已保存")',
      'preferences saved'
    )
    await send('Page.reload')
    await check(
      'document.querySelector(".profile-preferences .profile-row:last-of-type button:last-child")?.getAttribute("aria-pressed")==="true"',
      'preferences survive reload'
    )
    await snap('profile-preferences')
    await go('/candidates')
    await check(
      'location.search.includes("view=table") && !!document.querySelector(".v4-view-switch")',
      'candidate table default'
    )
    await go('/candidates?view=board&applicationStatus=active')
    await check(
      '!!document.querySelector(".v4-stage-scroll") && location.search.includes("view=board")',
      'explicit board and filter beat default'
    )
    await go('/interviews')
    await check('!!document.querySelector(".v4-week[data-mode=month]")', 'month default')
    await go('/interviews?view=day&date=2026-11-26')
    await check(
      '!!document.querySelector(".v4-week[data-mode=day]") && document.querySelector(".v4-week-header h2").textContent.includes("2026.11.26")',
      'explicit date and mode beat default'
    )
    const full = '.v4-fullscreen'
    await send('Page.bringToFront')
    if (process.argv.includes('--headed')) await send('Emulation.clearDeviceMetricsOverride')
    const nativeClick = async () => {
      await check(
        'document.querySelector(".v4-fullscreen")?.getBoundingClientRect().width > 0 && !document.querySelector(".v4-fullscreen").disabled',
        'fullscreen control ready'
      )
      const { x, y } = await evaluate(
        '(() => {const b=document.querySelector(".v4-fullscreen").getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()'
      )
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        buttons: 1,
        clickCount: 1
      })
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1
      })
    }
    await evaluate('window.fullscreenProbe = {}; const nativeFullscreen = document.documentElement.requestFullscreen; document.documentElement.requestFullscreen = function () { window.fullscreenProbe.activation = navigator.userActivation.isActive; return nativeFullscreen.call(this).catch(error => { window.fullscreenProbe.rejection = String(error); throw error }) }')
    await nativeClick()
    try {
      await check(
        'document.fullscreenElement===document.documentElement && document.querySelector(".v4-fullscreen").getAttribute("aria-label")==="退出全屏"',
        'native fullscreen entry'
      )
    } catch (error) {
      console.log(
        await evaluate(
          '({probe:window.fullscreenProbe, actual:!!document.fullscreenElement, label:document.querySelector(".v4-fullscreen")?.getAttribute("aria-label"), error:document.querySelector(".v4-fullscreen-status")?.textContent})'
        )
      )
      throw error
    }
    await check(
      'location.search.includes("date=2026-11-26") && !!document.querySelector(".v4-week[data-mode=day]")',
      'fullscreen preserves calendar'
    )
    await snap('native-fullscreen')
    await nativeClick()
    await check(
      '!document.fullscreenElement && document.querySelector(".v4-fullscreen").ariaLabel==="进入全屏"',
      'native click exit'
    )
    await nativeClick()
    await check('!!document.fullscreenElement', 'second native entry')
    await evaluate('document.exitFullscreen()')
    await check(
      '!document.fullscreenElement && document.querySelector(".v4-fullscreen").ariaLabel==="进入全屏"',
      'external fullscreen exit'
    )
    await evaluate(
      'document.documentElement.requestFullscreen=()=>Promise.reject(new Error("fixture"))'
    )
    await nativeClick()
    await check(
      '!document.fullscreenElement && !!document.querySelector(".v4-fullscreen-status")',
      'fullscreen error feedback'
    )
    await go('/profile')
    await check(
      `document.querySelector(${JSON.stringify(full)}) && document.querySelector(".profile-preferences .profile-row:last-of-type button:last-child").getAttribute("aria-pressed")==="true"`,
      'manual calendar choice does not overwrite preference'
    )
    await click('.profile-exit')
    await h1('欢迎回来')
    await button('一键填入')
    await button('登录工作台')
    await check('!!document.querySelector(".v3-account")', 'Demo signed in again')
    await go('/profile')
    await check(
      'document.querySelector(".profile-preferences .profile-row:last-of-type button:last-child")?.getAttribute("aria-pressed")==="true"',
      'preference survives sign out and sign in'
    )
    await send('Page.enable')
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false, configurable: true })'
    })
    await go('/profile?fullscreen-check=unsupported')
    await h1('个人中心')
    await check(
      'document.fullscreenEnabled === false && !document.querySelector(".v4-fullscreen")',
      'unsupported fullscreen hides control'
    )
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    console.log('Work preferences, native fullscreen entry/exit, external exit, request failure and unsupported browser verified')
  }
  const summary = await get('/dashboard/summary')
  const history = await get('/dashboard/history-metrics')
  const today = await get('/dashboard/today-interviews?limit=10&offset=0')
  const interviewCounts = Object.fromEntries(
    await Promise.all(
      ['scheduled', 'completed', 'cancelled'].map(async (status) => [
        status,
        (await get('/interviews?limit=1&status=' + status)).total
      ])
    )
  )
  const positions = await get('/positions?status=open&limit=100')
  const recent = positions.items
    .filter((row) => row.deletedAt == null)
    .sort((a, b) => b.publishDate.localeCompare(a.publishDate) || a.id - b.id)
    .slice(0, 3)
    .map(({ id, title, publishDate, applicationRecords }) => ({
      id,
      title,
      publishDate,
      applicationRecords
    }))
  const phases = Object.fromEntries(
    await Promise.all(
      ['screening', 'first_interview', 'second_interview', 'offer'].map(async (s) => [
        s,
        (await get('/applications?applicationStatus=active&stage=' + s + '&limit=1')).total
      ])
    )
  )
  await writeFile(
    join(output, 'runtime-stats.json'),
    JSON.stringify(
      {
        detailId: detail.id,
        summary,
        history,
        today: { total: today.total, byStatus: today.byStatus },
        interviewCounts,
        loginGeometry,
        weekCards,
        recent,
        phases
      },
      null,
      2
    )
  )
  console.log(
    'PASS rich Demo Chromium: dashboard, positions, board, table, detail, calendar, legacy'
  )
} finally {
  ws?.close()
  chrome.kill()
}
