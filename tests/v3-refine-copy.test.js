import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = readFileSync(new URL('../src/api/recruiting-v3.ts', import.meta.url), 'utf8')
const code = stripTypeScriptTypes(
  source.replace(
    "import { readV3 } from './request-v3'",
    'const readV3 = () => { throw new Error("Not a request test") }'
  )
)
const { label, applicationOutcomeText, applicationOfferText } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)
test('known outcomes and independent state dimensions retain business meaning', () => {
  assert.equal(label('company_rejected'), '企业淘汰')
  assert.equal(label('candidate_withdrew'), '候选人退出')
  assert.equal(label('offer_declined'), 'Offer 被拒')
  assert.equal(label('hired'), '已录用')
  assert.notEqual(label('closed'), label('hired'))
  assert.notEqual(label('active'), label('hired'))
  assert.match(label('accepted'), /待 HR 确认/)
  assert.equal(label('first_interview'), '初面')
})
test('unknown history never acquires a fabricated outcome', () => {
  assert.equal(label('unverified_legacy'), '未知，待核实')
  assert.equal(label(null), '—')
})

test('resolved cancel validation never hides server or conflict errors', () => {
  const source = readFileSync(
    new URL('../src/components/V3InterviewEditor.vue', import.meta.url),
    'utf8'
  )
  const start = source.indexOf('function clearResolvedReasonError()')
  const end = source.indexOf('async function submit()', start)
  const fn = source.slice(start, end)
  const run = new Function(
    'reason',
    'error',
    'conflict',
    'uncertain',
    fn + ';clearResolvedReasonError();return error.value'
  )
  assert.equal(
    run({ value: '真实原因' }, { value: '请填写取消原因。' }, { value: false }, { value: false }),
    ''
  )
  for (const message of ['服务器拒绝', '权限不足', '版本冲突'])
    assert.equal(
      run({ value: '原因' }, { value: message }, { value: false }, { value: false }),
      message
    )
  assert.equal(
    run({ value: '原因' }, { value: '请填写取消原因。' }, { value: true }, { value: false }),
    '请填写取消原因。'
  )
  assert.equal(
    run({ value: '原因' }, { value: '请填写取消原因。' }, { value: false }, { value: true }),
    '请填写取消原因。'
  )
})

test('shared label rejects prototype properties and preserves empty behavior', () => {
  for (const v of ['unknown', 'toString', 'constructor', '__proto__'])
    assert.equal(label(v), '未知，待核实')
  for (const v of [null, undefined, '']) assert.equal(label(v), '—')
  assert.equal(label('active'), '进行中')
})
test('application list helpers preserve legal empty and historical states', () => {
  const cases = [
    [
      { stage: 'screening', applicationStatus: 'active', offerStatus: null, outcome: null },
      '尚未结束',
      '未进入 Offer'
    ],
    [
      { stage: 'offer', applicationStatus: 'active', offerStatus: 'preparing', outcome: null },
      '尚未结束',
      '准备中'
    ],
    [
      { stage: 'offer', applicationStatus: 'active', offerStatus: 'sent', outcome: null },
      '尚未结束',
      '已发送'
    ],
    [
      { stage: 'offer', applicationStatus: 'active', offerStatus: 'accepted', outcome: null },
      '尚未结束',
      '已接受，待 HR 确认'
    ],
    [
      {
        stage: 'screening',
        applicationStatus: 'closed',
        offerStatus: null,
        outcome: 'company_rejected'
      },
      '企业淘汰',
      '未进入 Offer'
    ],
    [
      { stage: 'offer', applicationStatus: 'closed', offerStatus: 'accepted', outcome: 'hired' },
      '已录用',
      '已接受（历史事实）'
    ],
    [
      { stage: 'unknown', applicationStatus: 'closed', offerStatus: null, outcome: null },
      '未记录结束结果',
      '未记录 Offer 状态'
    ],
    [
      {
        stage: 'unknown',
        applicationStatus: 'closed',
        offerStatus: '__proto__',
        outcome: 'constructor'
      },
      '未知，待核实',
      '未知，待核实'
    ]
  ]
  for (const [row, outcome, offer] of cases) {
    assert.equal(applicationOutcomeText(row), outcome)
    assert.equal(applicationOfferText(row), offer)
  }
})
