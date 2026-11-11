import assert from 'node:assert/strict'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
export async function checkSummary({ evaluate, db, output, name }) {
  const data = await evaluate(
    '(()=>{const root=document.querySelector(".v3-recruiting"),s=document.querySelector(".v3-detail-summary");if(!root||!s)return null;const row=root.__vueParentComponent.setupState.selected;return {row:{id:row.id,stage:row.stage,applicationStatus:row.applicationStatus,outcome:row.outcome,offerStatus:row.offerStatus,version:row.version},editing:!!root.querySelector(".v3-advance-editor,.v3-feedback-editor,.v3-offer-editor"),values:Object.fromEntries([...s.querySelectorAll(".v3-detail-states dt")].map(e=>[e.textContent,e.nextElementSibling.textContent.trim()])),text:s.textContent}})()'
  )
  if (!data) return
  const actual = db.prepare('SELECT * FROM candidates WHERE id=?').get(data.row.id)
  assert.ok(actual, 'summary application exists in real isolated DB')
  assert.ok(
    data.row.version <= actual.version,
    'confirmed snapshot cannot exceed committed version'
  )
  if (data.row.version !== actual.version)
    assert.ok(
      data.editing,
      'older confirmed snapshot only while editor owns an in-flight or unconfirmed operation'
    )
  const row =
    data.row.version === actual.version
      ? actual
      : {
          ...actual,
          stage: data.row.stage,
          application_status: data.row.applicationStatus,
          outcome: data.row.outcome,
          offer_status: data.row.offerStatus
        }
  for (const [http, sql] of [
    ['stage', 'stage'],
    ['applicationStatus', 'application_status'],
    ['offerStatus', 'offer_status'],
    ['outcome', 'outcome']
  ])
    assert.equal(data.row[http], row[sql])
  const stages = {
    screening: '筛选',
    first_interview: '初面',
    second_interview: '复面',
    offer: 'Offer'
  }
  const results = {
    company_rejected: '企业淘汰',
    candidate_withdrew: '候选人退出',
    hired: '已录用',
    offer_declined: 'Offer 被拒'
  }
  assert.equal(data.values['招聘阶段'], stages[row.stage])
  assert.equal(data.values['申请状态'], row.application_status === 'active' ? '进行中' : '已结束')
  assert.equal(
    data.values['结束结果'],
    row.outcome
      ? results[row.outcome]
      : row.application_status === 'active'
        ? '尚未结束'
        : '未记录结束结果'
  )
  if (row.offer_status === 'accepted' && row.application_status === 'active') {
    assert.notEqual(data.values['结束结果'], '已录用')
    assert.ok(data.values['Offer 状态'].includes('待 HR 确认'))
  }
  await appendFile(
    join(output, 'r03b-summary-matrix.jsonl'),
    JSON.stringify({
      name,
      id: row.id,
      stage: row.stage,
      status: row.application_status,
      outcome: row.outcome,
      offerStatus: row.offer_status,
      rendered: data.values,
      confirmedVersion: data.row.version,
      databaseVersion: actual.version,
      snapshot:
        data.row.version === actual.version
          ? 'current committed facts'
          : 'last confirmed API snapshot during editing; not latest write result'
    }) + '\n'
  )
}
