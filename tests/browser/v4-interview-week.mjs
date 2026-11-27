import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDemoServer } from '../../server/index-demo-v3.js'
import { dayMs, shanghaiDay, shanghaiWeek } from '../../src/api/v4-interview-week.ts'

const output = process.argv[2]
if (!output) throw new Error('Provide an evidence directory')
await mkdir(output)
const profile = await mkdtemp(join(tmpdir(), 'hireflow-week-chrome-'))
const app = await startDemoServer({ port: 0, staticDir: process.argv[3] })
const url = 'http://127.0.0.1:' + app.server.address().port
const start = shanghaiWeek(Date.now())
const add = app.db.prepare(
  'INSERT INTO interviews(candidate_id,stage_scope,scheduled_at,interviewer_name,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?)'
)
const open = app.db
  .prepare(
    `SELECT id,stage FROM candidates c WHERE application_status='active'
  AND stage IN ('first_interview','second_interview') AND NOT EXISTS(
  SELECT 1 FROM interviews i WHERE i.candidate_id=c.id AND status='scheduled') ORDER BY id`
  )
  .all()
const fixture = open[0]
for (let i = 0; i < 105; i++)
  add.run(
    fixture.id,
    fixture.stage,
    start - dayMs + i,
    '隔离历史',
    'completed',
    start - 2 * dayMs,
    start - dayMs
  )
for (let i = 0; i < 27; i++)
  add.run(
    fixture.id,
    fixture.stage,
    start + 10 * 3_600_000 + i * 60_000,
    '隔离聚合',
    'completed',
    start - dayMs,
    start + dayMs
  )
add.run(fixture.id, fixture.stage, start, '隔离午夜', 'completed', start - dayMs, start)
add.run(
  fixture.id,
  fixture.stage,
  start + 9 * 3_600_000,
  '隔离普通卡',
  'completed',
  start - dayMs,
  start
)
add.run(
  fixture.id,
  fixture.stage,
  start + 7 * dayMs - 1,
  '隔离夜间',
  'completed',
  start - dayMs,
  start + 7 * dayMs
)
const scheduled = Number(
  add.run(
    fixture.id,
    fixture.stage,
    start + 2 * dayMs + 14 * 3_600_000,
    '隔离改期',
    'scheduled',
    start - dayMs,
    null
  ).lastInsertRowid
)
const chrome = spawn(
  process.env.CHROME_BIN ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--disable-background-networking',
    '--no-first-run',
    '--remote-debugging-port=0',
    '--user-data-dir=' + profile,
    'about:blank'
  ],
  { windowsHide: true, stdio: 'ignore' }
)
let ws
let sequence = 0
const pending = new Map()
const requests = []
const dialogs = []
let accept = false
let failSecond = true
let holdNext = false
let held
const cases = {}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(fn, title) {
  for (let i = 0; i < 200; i++) {
    const value = await fn()
    if (value) return value
    await delay(100)
  }
  throw new Error(title)
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
async function js(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    userGesture: true
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description)
  return result.result.value
}
const check = (expr, title) => until(() => js(expr), title)
const click = (selector) => js('document.querySelector(' + JSON.stringify(selector) + ').click()')
const findButton = (name) =>
  `[...document.querySelectorAll('button')].find(b => b.getClientRects().length && (b.textContent.trim() === ${JSON.stringify(name)} || b.getAttribute('aria-label') === ${JSON.stringify(name)}))`
async function button(name) {
  const el = findButton(name)
  await check(`!!(${el}) && !(${el}).disabled`, name)
  await js(`(${el}).click()`)
}
const view = (width, height) =>
  send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
const go = (path) => send('Page.navigate', { url: url + path })
async function snap(file, clip) {
  await js('document.activeElement?.getBoundingClientRect().top')
  const picture = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    ...(clip && { clip: { ...clip, scale: 1 } })
  })
  await writeFile(join(output, file + '.png'), Buffer.from(picture.data, 'base64'))
}
async function measureStack(file) {
  const result = await js(`(() => {
    const front = document.querySelector('.v4-week-event[data-status="group"]')
    const back = front.previousElementSibling.getBoundingClientRect()
    const ordinary = document.querySelector('.v4-week-event[data-status="completed"]')
    const main = front.getBoundingClientRect()
    const icon = front.querySelector('.v4-week-layer').getBoundingClientRect()
    const column = front.closest('.v4-week-day').getBoundingClientRect()
    return {
      ordinaryHeight: ordinary.offsetHeight, ordinaryWidth: ordinary.getBoundingClientRect().width,
      mainHeight: main.height, mainWidth: main.width, backHeight: back.height,
      offsetX: back.x - main.x, offsetY: back.y - main.y, rightAligned: back.right === main.right,
      iconWidth: icon.width, iconHeight: icon.height, selected: front.getAttribute('aria-expanded'),
      fitsColumn: back.right <= column.right,
      clearRows: [...document.querySelectorAll('.v4-week-day')].every(day => {
        const rows = [...day.querySelectorAll('.v4-week-slot')]
        return rows.every((row, i) => !i || rows[i - 1].lastElementChild.getBoundingClientRect().bottom
          + (rows[i - 1].querySelector('.v4-week-stack') ? 4 : 0) <= row.getBoundingClientRect().top)
      }),
      clip: { x: Math.floor(main.x) - 3, y: Math.floor(main.y) - 3,
        width: Math.ceil(main.width) + 6, height: Math.ceil(back.bottom - main.y) + 6 }
    }
  })()`)
  const { clip, ...sizes } = result
  assert.equal(sizes.ordinaryHeight, 56)
  assert.equal(sizes.mainHeight, 56)
  assert.equal(sizes.backHeight, 56)
  assert.deepEqual(
    [sizes.offsetX, sizes.offsetY, sizes.iconWidth, sizes.iconHeight],
    [4, 4, 32, 29]
  )
  assert.ok(sizes.rightAligned && sizes.fitsColumn && sizes.clearRows)
  await snap(file, clip)
  return sizes
}
async function input(label, value) {
  const query = '[aria-label="' + label + '"]'
  await check(`!!document.querySelector(${JSON.stringify(query)})`, label)
  await js(`(() => { const el = document.querySelector(${JSON.stringify(query)});
    el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`)
}
try {
  const port = await until(
    () =>
      readFile(join(profile, 'DevToolsActivePort'), 'utf8')
        .then((s) => s.split('\n')[0])
        .catch(() => null),
    'Chrome port'
  )
  const [page] = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request?.reject(new Error(message.error.message))
      else request?.resolve(message.result)
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params.message)
      void send('Page.handleJavaScriptDialog', { accept })
    }
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const query = new URL(request.url).searchParams
      requests.push(Object.fromEntries(query))
      if (query.get('limit') === '100' && holdNext) {
        holdNext = false
        held = requestId
      } else if (query.get('limit') === '100' && query.get('offset') === '100' && failSecond) {
        failSecond = false
        void send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from('{"error":{"code":"FIXTURE","message":"隔离读取失败"}}').toString(
            'base64'
          )
        })
      } else void send('Fetch.continueRequest', { requestId })
    }
  }
  await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/v3/interviews?*' }] })
  await view(1920, 1080)
  await go('/interviews')
  await button('一键填入演示账号')
  await button('登录工作台')
  await check(
    '!!document.querySelector(".v4-week-message[data-state=failed]")',
    'second source page failure'
  )
  await snap('week-partial')
  await button('重试当前页')
  await check(
    'document.querySelector(".v4-week-event[data-status=group]") && !document.querySelector(".v4-week-message")',
    'working calendar'
  )
  assert.ok(requests.filter((request) => request.offset === '100').length >= 2)
  const event = '[data-interview-id="' + scheduled + '"]'
  const calendar = '.v4-week-scroll'
  assert.equal(await js(`document.querySelector('${calendar}').scrollTop`), 512)
  await snap('week-1920')
  cases.regularStack = await measureStack('stack-regular')
  await button('月')
  await check(
    '!!document.querySelector(".v4-month-more") && !document.querySelector(".v4-week-message")',
    'month coverage'
  )
  assert.equal(await js('document.querySelectorAll(".v4-month-head span").length'), 7)
  assert.ok(await js('document.querySelectorAll(".v4-month-day").length % 7 === 0'))
  assert.ok(await js('!!document.querySelector(".v4-month-day.spillover")'))
  await snap('month-1920')
  await click('.v4-month-more')
  await check(
    'document.querySelectorAll(".v4-interview-members button").length >= 27',
    'month members accessible'
  )
  await button('关闭面试侧面板')
  await click('.v4-month-event' + event)
  await check(
    'document.querySelector(".v4-interview-panel")?.textContent.includes("隔离改期")',
    'month direct event details'
  )
  await button('关闭面试侧面板')
  const monthTitle = await js('document.querySelector(".v4-week-header h2").textContent')
  await button('下一月')
  await check(
    `document.querySelector(".v4-week-header h2").textContent !== ${JSON.stringify(monthTitle)}`,
    'next month'
  )
  await button('回到本月')
  await check(
    `document.querySelector(".v4-week-header h2").textContent === ${JSON.stringify(monthTitle)}`,
    'return to this month'
  )
  const monday = shanghaiDay(start)
  await click('[aria-label="' + monday + ' 日视图"]')
  await check(
    'document.querySelectorAll(".v4-week-day").length === 1 && !!document.querySelector(".v4-week-event[data-status=group]")',
    'day activated'
  )
  assert.equal(await js(`document.querySelector('${calendar}').scrollTop`), 512)
  await snap('day-1920')
  await button('下一天')
  await check(
    `document.querySelector(".v4-week-header h2").textContent === "${shanghaiDay(start + dayMs).replaceAll('-', '.')}"`,
    'day next'
  )
  await button('上一天')
  await check(
    `document.querySelector(".v4-week-header h2").textContent === "${monday.replaceAll('-', '.')}"`,
    'day previous'
  )
  await button('回到今天')
  await check(
    `document.querySelector(".v4-week-header h2").textContent === "${shanghaiDay(Date.now()).replaceAll('-', '.')}"`,
    'day today'
  )
  await button('周')
  await check(
    'document.querySelectorAll(".v4-week-day").length === 7 && !!document.querySelector(".v4-week-event[data-status=group]")',
    'returned to week'
  )
  await js(`document.querySelector('${calendar}').scrollTop = 333`)
  await button('刷新面试记录')
  await check(
    '!!document.querySelector(".v4-week-event[data-status=group]") && !document.querySelector(".v4-week-message")',
    'week refreshed'
  )
  assert.equal(await js(`document.querySelector('${calendar}').scrollTop`), 333)
  cases.calendarModes = { day: true, month: true, navigation: true, preservesRefreshScroll: true }
  const y = await js('document.querySelector(".v4-week-head").getBoundingClientRect().top')
  await js(`document.querySelector('${calendar}').scrollTop = 10000`)
  assert.equal(await js('document.querySelector(".v4-week-head").getBoundingClientRect().top'), y)
  assert.ok(
    await js(
      '[...document.querySelectorAll(".v4-week-event")].some(el=>el.textContent.includes("23:59"))'
    )
  )
  await js(`document.querySelector('${calendar}').scrollTop = 0`)
  assert.ok(
    await js(
      '[...document.querySelectorAll(".v4-week-event")].some(el=>el.textContent.includes("00:00"))'
    )
  )
  await button('定位 08:00')
  await js('document.querySelector(".v4-week-event[data-status=group]").focus()')
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    text: '\r',
    windowsVirtualKeyCode: 13
  })
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13
  })
  await check(
    'document.querySelectorAll(".v4-interview-members button").length >= 27',
    'all grouped records accessible'
  )
  await snap('week-cluster')
  cases.compactStack = await measureStack('stack-compact')
  assert.equal(cases.compactStack.selected, 'true')
  await click(event)
  await check(
    'document.querySelector(".v4-interview-panel").textContent.includes("隔离改期")',
    'fresh detail'
  )
  await snap('week-detail')
  await button('改期')
  const next = new Date(start + 8 * dayMs + 16 * 3_600_000).toISOString().slice(0, 16)
  await input('预约开始时间', next)
  await snap('week-reschedule')
  for (const action of ['下一周', '关闭面试侧面板', '列表']) {
    const before = dialogs.length
    await button(action)
    await until(() => dialogs.length > before, 'draft guard ' + action)
    assert.equal(await js('document.querySelector(".v3-interview-editor input").value'), next)
  }
  const beforeSelection = dialogs.length
  await click('.v4-week-event[data-status=group]')
  await until(() => dialogs.length > beforeSelection, 'switching events guards draft')
  await js('document.querySelector(".v3-interview-editor form").requestSubmit()')
  await check(
    `!document.querySelector(${JSON.stringify(event)}) && !document.querySelector(".v4-week-message") && !document.querySelector(".v3-interview-editor")`,
    'moved away from source week'
  )
  await button('下一周')
  await check(`!!document.querySelector(${JSON.stringify(event)})`, 'moved to next week')
  holdNext = true
  await button('上一周')
  await until(() => held, 'in-flight week request')
  await button('下一周')
  await check(
    `!!document.querySelector(${JSON.stringify(event)})`,
    'latest week loaded before stale'
  )
  await send('Fetch.continueRequest', { requestId: held })
  await delay(200)
  assert.ok(await js(`!!document.querySelector(${JSON.stringify(event)})`))
  await input('申请 ID', String(fixture.id))
  await button('筛选')
  await check('!document.querySelector(".v4-week-message")', 'applied filter')
  for (const [width, height] of [
    [1440, 900],
    [1024, 768]
  ]) {
    await view(width, height)
    assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'))
    assert.ok(await js('document.querySelector(".v4-week-scroll").clientHeight > 200'))
    await snap(`week-${width}`)
  }
  await view(1366, 768)
  await snap('week-1366')
  await button('月')
  await check('!!document.querySelector(".v4-month-day")', 'month at 1366')
  await snap('month-1366')
  await view(390, 844)
  assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'))
  await snap('month-390')
  await button('周')
  await check('!!document.querySelector(".v4-week[data-mode=week] .v4-week-scroll")', 'week rendered after navigation')
  assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'))
  assert.ok(
    await js(
      'document.querySelector(".v4-week-scroll").scrollWidth > document.querySelector(".v4-week-scroll").clientWidth'
    )
  )
  await snap('week-390')
  await send('Emulation.clearDeviceMetricsOverride')
  const { windowId } = await send('Browser.getWindowForTarget')
  await send('Browser.setWindowBounds', { windowId, bounds: { width: 1440, height: 900 } })
  const {
    targetInfo: { targetId: originalTab }
  } = await send('Target.getTargetInfo')
  const { targetId } = await send('Target.createTarget', {
    url: 'chrome://settings/appearance',
    background: true
  })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await until(
    async () =>
      (
        await send(
          'Runtime.evaluate',
          {
            expression: 'typeof chrome.settingsPrivate?.setDefaultZoom === "function"',
            returnByValue: true
          },
          sessionId
        )
      ).result.value,
    'native zoom settings'
  )
  await send(
    'Runtime.evaluate',
    { expression: 'chrome.settingsPrivate.setDefaultZoom(2)' },
    sessionId
  )
  await send('Target.activateTarget', { targetId: originalTab })
  await send('Page.reload')
  await check(
    'devicePixelRatio >= 1.95 && innerWidth < 750 && !!document.querySelector(".v4-week-scroll")',
    'native 200% zoom'
  )
  assert.ok(await js('document.documentElement.scrollWidth <= innerWidth + 1'))
  await snap('week-native-200')
  await send(
    'Runtime.evaluate',
    { expression: 'chrome.settingsPrivate.setDefaultZoom(1)' },
    sessionId
  )
  await send('Target.closeTarget', { targetId })
  cases.nativeZoom = true
  await view(1920, 1080)
  for (let i = 0; i < 1200; i++)
    add.run(
      fixture.id,
      fixture.stage,
      start - 3 * dayMs + i,
      '隔离预算',
      'completed',
      start - 4 * dayMs,
      start - dayMs
    )
  await check(
    '!document.querySelector(".v4-week-message[data-state=reading]")',
    'initial read settled'
  )
  await button('刷新面试记录')
  await check(
    '!!document.querySelector(".v4-week-message[data-state=budget]")',
    'budget shown instead of empty'
  )
  await snap('week-budget')
  cases.budget = true
  await button('月')
  await check(
    '!!document.querySelector(".v4-month-day") && !!document.querySelector(".v4-week-message[data-state=budget]")',
    'month keeps bounded incomplete state'
  )
  await snap('month-budget')
  cases.monthBudget = true
  await button('列表')
  await check(
    'document.querySelectorAll("tbody tr[data-interview-id]").length === 20',
    'global 20-row list'
  )
  assert.ok(await js('document.querySelector("tbody").textContent.includes("隔离预算")'))
  await snap('interviews-list')
  await go('/candidates/21')
  await check('!!document.querySelector("[data-detail-tab=interviews]")', 'embedded detail tabs')
  await click('[data-detail-tab=interviews]')
  await check(
    '!!document.querySelector(".v3-feedback-card") && !document.querySelector(".v4-week")',
    'embedded mode unchanged'
  )
  const embed = await js(`(() => {
    const classes = ['.v3-detail-aside','.v4-detail-tabbar'];
    return classes.map(s => getComputedStyle(document.querySelector(s)).position);
  })()`)
  assert.deepEqual(embed, ['sticky', 'sticky'])
  const booking = open.find((row) => row.id !== fixture.id)
  await go('/candidates/' + booking.id)
  await check('!!document.querySelector("[data-detail-tab=interviews]")', 'scheduling detail')
  await click('[data-detail-tab=interviews]')
  await button('安排面试')
  await input('预约开始时间', next)
  await input('专业面试官姓名', '隔离预约')
  await js('document.querySelector(".v3-interview-editor form").requestSubmit()')
  await check('!document.querySelector(".v3-interview-editor")', 'embedded schedule saved')
  assert.equal(
    app.db
      .prepare(
        "SELECT interviewer_name FROM interviews WHERE candidate_id=? AND status='scheduled'"
      )
      .get(booking.id)?.interviewer_name,
    '隔离预约'
  )
  cases.week = {
    sourcePaging: true,
    retry: true,
    staleIgnored: true,
    midnightAndLate: true,
    stickyHeader: true,
    reschedule: true,
    groupCountAtLeast: 27
  }
  cases.list = { rowsPerPage: 20, allWeeks: true }
  cases.embedded = { unchanged: true, sticky: embed, scheduled: true }
  await writeFile(
    join(output, 'results.json'),
    JSON.stringify(
      { browser: (await send('Browser.getVersion')).product, cases, requests, dialogs },
      null,
      2
    )
  )
} finally {
  ws?.close()
  chrome.kill()
  await app.close()
}
