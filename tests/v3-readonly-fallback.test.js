import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parse, compileTemplate } = require('vue/compiler-sfc')
const Vue = require('vue')
const { renderToString } = require('vue/server-renderer')
async function mappings(path) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*$/gm, '')
  return import(
    'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(text)).toString('base64')
  )
}
const { outcomes, offerStatuses, eventNames } = await mappings('../src/api/offer-v3.ts')
const { kinds, stages } = await mappings('../src/api/advancement-v3.ts')
function component(name) {
  const filename = new URL('../src/components/' + name + '.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'))
  let { code, errors } = compileTemplate({
    source: descriptor.template.content,
    filename: filename.pathname,
    id: 'test-' + name
  })
  assert.deepEqual(errors, [])
  code = code.replace(
    /import \{([^]*?)\} from "vue"/g,
    (_, spec) => 'const {' + spec.replace(/ as /g, ':') + '}=Vue'
  )
  code = code.replace('export function render', 'function render')
  return new Function('Vue', code + ';return render')(Vue)
}
const stateRender = component('V3OfferState')
const renderers = {
  V3OfferState: stateRender,
  V3OfferPanel: component('V3OfferPanel'),
  V3AdvancementPanel: component('V3AdvancementPanel')
}
const base = {
  stage: 'offer',
  applicationStatus: 'active',
  offerStatus: 'accepted',
  outcome: null,
  closedAt: null,
  closedReason: null,
  version: 3
}
async function render(name, ctx) {
  const app = Vue.createSSRApp({
    data: () => ({
      load() {},
      loadHistory() {},
      props: { disabled: false },
      loading: false,
      error: '',
      state: null,
      historyLoading: false,
      historyError: '',
      history: [],
      operationError: '',
      editor: null,
      gate: { current: { value: null } },
      v3Session: { state: { status: 'ready' } },
      stages,
      kinds,
      eventNames,
      outcomes,
      offerStatuses,
      label: (v) => v ?? '—',
      feedbackTime: () => '2030-01-01',
      ...ctx
    }),
    render: renderers[name]
  })
  for (const name of [
    'el-button',
    'V3Feedback',
    'V3OfferEditor',
    'V3AdvancementFacts',
    'V3AdvancementEditor'
  ])
    app.component(name, { render: () => null })
  app.component('V3OfferState', {
    props: ['state'],
    data: () => ({
      label: (v) => v ?? '—',
      offerStatuses,
      outcomes,
      feedbackTime: () => '2030-01-01'
    }),
    render: stateRender
  })
  return renderToString(app)
}
test('real OfferState template distinguishes all known outcomes, unknown and absent values', async () => {
  for (const [value, text] of Object.entries(outcomes)) {
    const html = await render('V3OfferState', { state: { ...base, outcome: value } })
    assert.match(html, new RegExp(text))
  }
  for (const [value, text] of Object.entries(offerStatuses)) {
    const html = await render('V3OfferState', { state: { ...base, offerStatus: value } })
    assert.ok(html.includes(text))
  }
  for (const value of ['legacy_unknown', 'toString', 'constructor']) {
    const html = await render('V3OfferState', {
      state: { ...base, offerStatus: value, outcome: value }
    })
    assert.equal((html.match(/未知，待核实/g) || []).length, 2)
    assert.ok(!html.includes(value))
    assert.ok(!html.includes('已录用'))
  }
  const missing = await render('V3OfferState', {
    state: { ...base, applicationStatus: 'closed', offerStatus: null, outcome: null }
  })
  assert.ok(missing.includes('未记录 Offer 状态') && missing.includes('未记录结束结果'))
  assert.ok(!missing.includes('未知，待核实'))
  const accepted = await render('V3OfferState', { state: base })
  assert.ok(accepted.includes('待 HR 确认录用') && !accepted.includes('已录用'))
  const closed = await render('V3OfferState', {
    state: { ...base, applicationStatus: 'closed', outcome: 'hired' }
  })
  assert.ok(closed.includes('已接受（Offer 最后事实）') && closed.includes('已录用'))
})
function event(value) {
  return {
    eventId: 9,
    eventType: value,
    kind: value,
    actorName: '虚构HR',
    actorUserId: 7,
    occurredAt: 123,
    reason: '保留原因',
    reasonSource: value,
    before: base,
    after: base,
    fromStage: 'first_interview',
    toStage: 'second_interview',
    missingInterviews: []
  }
}
test('real OfferPanel event template renders known, unknown and missing names and preserves snapshots', async () => {
  for (const [value, text] of Object.entries(eventNames)) {
    const html = await render('V3OfferPanel', { history: [event(value)] })
    assert.ok(html.includes(text))
  }
  for (const value of ['future_event', 'toString', null, '']) {
    const html = await render('V3OfferPanel', { history: [event(value)] })
    assert.ok(html.includes(value ? '未知，待核实' : '未记录事件类型'))
    assert.ok(
      html.includes('保留原因') &&
        html.includes('虚构HR') &&
        html.includes('操作前') &&
        html.includes('操作后')
    )
    if (value) assert.ok(!html.includes(value))
  }
})
test('real AdvancementPanel template safely renders independent kind and event-type paths', async () => {
  for (const [value, text] of Object.entries(kinds)) {
    const html = await render('V3AdvancementPanel', {
      history: [{ ...event('stage_advanced'), kind: value }]
    })
    assert.ok(html.includes(text) && html.includes('阶段晋级'))
  }
  for (const value of ['future_kind', 'toString', null, '']) {
    const html = await render('V3AdvancementPanel', { history: [event(value)] })
    assert.ok(html.includes(value ? '未知，待核实' : '未记录晋级类型'))
    assert.ok(html.includes('保留原因') && html.includes('虚构HR') && html.includes('事件 #9'))
    if (value) assert.ok(!html.includes(value))
  }
})

test('OfferState distinguishes legal nulls from missing legacy facts', async () => {
  const cases = [
    [
      { ...base, stage: 'screening', offerStatus: null, outcome: null },
      ['未进入 Offer', '尚未结束'],
      ['未记录', '已录用']
    ],
    [
      { ...base, offerStatus: 'preparing', outcome: null },
      ['准备中，尚未确认发送', '尚未结束'],
      ['未记录结束结果', '已录用']
    ],
    [
      {
        ...base,
        applicationStatus: 'closed',
        stage: 'screening',
        outcome: 'company_rejected',
        offerStatus: null
      },
      ['企业淘汰', '未进入 Offer'],
      ['尚未结束', '已录用']
    ],
    [
      { ...base, applicationStatus: 'closed', offerStatus: null, outcome: null },
      ['未记录 Offer 状态', '未记录结束结果'],
      ['尚未结束', '已录用']
    ],
    [
      {
        ...base,
        applicationStatus: 'closed',
        stage: 'legacy_unknown',
        offerStatus: null,
        outcome: null
      },
      ['未记录 Offer 状态', '未记录结束结果'],
      ['未进入 Offer', '尚未结束']
    ],
    [
      { ...base, offerStatus: 'future_status', outcome: 'future_result' },
      ['未知，待核实'],
      ['已录用', '尚未结束']
    ],
    [base, ['已接受，待 HR 确认录用', '尚未结束'], ['已录用']],
    [
      { ...base, applicationStatus: 'closed', outcome: 'hired' },
      ['已录用', '已接受（Offer 最后事实）'],
      ['尚未结束']
    ]
  ]
  for (const [state, expected, forbidden] of cases) {
    const html = await render('V3OfferState', { state })
    for (const value of expected)
      assert.ok(html.includes(value), JSON.stringify(state) + ' missing ' + value)
    for (const value of forbidden)
      assert.ok(!html.includes(value), JSON.stringify(state) + ' unexpected ' + value)
  }
})
