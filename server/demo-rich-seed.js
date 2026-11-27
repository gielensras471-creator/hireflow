import { randomUUID } from 'node:crypto'
import { createRecruitingService } from './services/recruiting-service.js'
import { createAdvancementService } from './services/advancement-service.js'
import { createInterviewService } from './services/interview-service.js'
import { createFeedbackService } from './services/feedback-service.js'
import { createOfferService } from './services/offer-service.js'

const hour = 3_600_000
const day = 24 * hour
const offset = 8 * hour
const volumes = [18, 25, 32, 39, 26, 33, 27]
const recentHistoryCount = 6
const roles = [
  ['前端开发工程师', '研发', '维护组件库与招聘漏斗页面，改善键盘访问'],
  ['后端开发工程师', '研发', '维护事务与审计事件，编写接口回归'],
  ['全栈开发工程师', '研发', '负责业务页面到接口交付，覆盖异常流程'],
  ['测试工程师', '质量', '设计数据边界用例与浏览器验收脚本'],
  ['AI 应用开发工程师', '研发', '验证内部工具输出质量并维护评估集'],
  ['数据分析工程师', '数据', '维护管理报表口径与数据质量检查'],
  ['移动端开发工程师', '研发', '负责手机端可访问性与页面稳定性'],
  ['UI/UX 设计师', '设计', '梳理应用组件与工作台信息密度'],
  ['产品经理', '产品', '负责需求访谈、验收规则与发布复盘'],
  ['交互设计师', '设计', '设计表单、导航与异常恢复交互'],
  ['视觉设计师', '品牌', '维护一致的界面色彩、图标和排版规范'],
  ['产品运营', '运营', '维护试用流程并归纳产品使用反馈'],
  ['内容运营', '运营', '维护帮助中心与产品更新内容'],
  ['市场专员', '市场', '策划线上活动并汇总渠道效果'],
  ['客户成功专员', '客户成功', '协助试用团队建立工作流程'],
  ['人力资源专员', '人力资源', '跟踪招聘安排与候选人沟通'],
  ['数据治理工程师', '数据', '定义元数据、校验规则与数据追溯'],
  ['技术文档编辑', '内容', '维护接口说明、示例及上手指南'],
  ['测试工程师', '平台', '维护持续验证流水线与性能样本'],
  ['项目协调专员', '运营', '维护交付依赖、里程碑与评审安排'],
  ['后端开发工程师', '平台', '负责权限流程的可观测性与故障定位'],
  ['招聘产品设计师', '产品设计', '优化日历、看板与招聘详情体验'],
  ['招聘数据分析师', '人才运营', '审核报表与面试统计的业务口径'],
  ['企业招聘顾问', '客户成功', '协助小团队配置招聘工作流并收集反馈']
]
const surnames = '林陈周许宋顾陆唐沈何叶梁苏方魏江俞姚温程'
const given = ['澄', '知远', '安然', '禾', '书予', '亦宁', '景行', '若初', '怀瑾', '时雨']

// Command Core uses a synchronous wall-clock read. Override it only for the
// duration of one isolated seed command, before this database has a listener.
function atTime(time, execute) {
  const realClock = Date.now
  try {
    Date.now = () => time
    return execute()
  } finally {
    Date.now = realClock
  }
}

export function seedRichDemo(db, options, context, now) {
  const local = new Date(now + offset)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const today = Math.floor((now + offset) / day) * day - offset
  const monday = today - ((local.getUTCDay() + 6) % 7) * day
  const upcoming = Array.from({ length: 14 }, (_, index) => monday + index * day)
    .flatMap((date) => [9, 11, 13, 15, 17].map((time) => date + time * hour))
    .filter((time) => time > now)
  // One slot per visible card, with a few planned groups of different sizes.
  const scheduledSlots = [1, 2, 1, 3, 1, 4, 1, 2, 1, 1, 1, 1, 1].flatMap((count, index) =>
    Array(count).fill(upcoming[index])
  )
  const dueSlots = [today - day + 11.5 * hour, today - day + 15.5 * hour]
  const pastSlots = Array.from({ length: 18 }, (_, index) => today - index * day)
    .flatMap((date) => [16, 14, 8].map((time) => date + time * hour))
    .filter((time) => time <= now && dueSlots.every((due) => Math.abs(time - due) >= hour))
  const historySlots = [
    ...pastSlots.slice(0, recentHistoryCount),
    ...pastSlots.slice(recentHistoryCount).filter((time) => time < monday)
  ]
  let extraHistory = 0
  const monthStart = (delta) => Date.UTC(year, month + delta, 1) - offset
  const iso = (time) => new Date(time + offset).toISOString().slice(0, 10)
  const recruiting = createRecruitingService(options)
  const interviews = createInterviewService(options)
  const advancement = createAdvancementService(options)
  const feedback = createFeedbackService(options)
  const offers = createOfferService(options)
  const versions = {
    candidate: db.prepare('SELECT version FROM candidates WHERE id=?'),
    position: db.prepare('SELECT version FROM positions WHERE id=?')
  }
  const run = (time, service, command, payload, id) =>
    atTime(
      time,
      () =>
        service.execute(context, {
          command,
          payload,
          idempotencyKey: randomUUID(),
          ...(id
            ? {
                aggregateId: id,
                expectedVersion:
                  versions[command.startsWith('position.') ? 'position' : 'candidate'].get(id)
                    .version
              }
            : {})
        }).result
    )
  const positions = roles.map(([title, department, detail], index) => {
    const time = index >= 21 ? today : monthStart(-6)
    return run(time, recruiting, 'position.create', {
      title: '[虚构演示] ' + title,
      department,
      location: ['深圳', '广州', '杭州', '上海', '远程'][index % 5],
      publish_date: iso(time),
      description: '虚构招聘：' + detail + '。请勿提交真实个人资料。'
    }).aggregateId
  })
  const cohorts = [
    ['screening', 32, true],
    ['first_interview', 22, true],
    ['second_interview', 17, true],
    ['offer', 9, true],
    ['screening', 45, false],
    ['first_interview', 27, false],
    ['second_interview', 20, false],
    ['offer', 28, false]
  ]
  const plans = cohorts.flatMap(([stage, count, active]) =>
    Array.from({ length: count }, (_, n) => ({ stage, active, n }))
  )
  let slot = 0
  for (const [bucket, count] of volumes.entries()) {
    const start = monthStart(bucket - 6)
    const end = Math.min(monthStart(bucket - 5) - day, today)
    const days = (end - start) / day + 1
    for (let i = 0; i < count; i++, slot++) {
      const { stage, active, n } = plans[(slot * 37) % plans.length]
      // Three same-day examples give each newest role its own interview workflow.
      const currentMonth = bucket === volumes.length - 1
      const newestRoleSample = currentMonth && [9, 25, 5].includes(i)
      const availableDays = currentMonth ? Math.max(1, days - 1) : days
      const applied = newestRoleSample ? today : start + ((i * 7 + bucket) % availableDays) * day
      const position = applied === today ? 21 + (i % 3) : slot % 21
      const identity = slot % 29 === 1 ? slot - 1 : slot
      const name = surnames[Math.floor(identity / 10)] + given[identity % 10]
      let date = applied
      const id = run(date, recruiting, 'application.create', {
        position_id: positions[position],
        name: '[虚构演示] ' + name,
        owner: ['虚构招聘组 · 林悦', '虚构招聘组 · 周言'][slot % 2],
        applied_date: iso(applied),
        education: ['本科（虚构）', '硕士（虚构）', '专科（虚构）'][slot % 3],
        school: '虚构星桥学院',
        email: 'candidate' + identity + '@example.invalid',
        phone: '000-0000-0000',
        skills: roles[position][2],
        experience: '虚构经历：参与' + roles[position][0] + '相关项目，负责跨组交付与结果复盘。',
        note: '共享虚构演示资料，请勿录入真实信息。'
      }).aggregateId
      const cmd = (service, command, payload = {}) => run(date, service, command, payload, id)
      const advance = (target_stage, reason) =>
        cmd(advancement, 'application.advance', { target_stage, ...(reason ? { reason } : {}) })
      const review = (mid, recommendation, command = 'feedback.submit') =>
        cmd(feedback, command, {
          interview_id: mid,
          reviewer_name: '虚构专业面试官',
          recommendation,
          reason: '虚构评估：依据岗位案例、专业沟通与交付复盘。'
        })
      const meeting = (status, scheduled, evaluation = false, reschedule = false) => {
        // Registration precedes the scheduled time, and recorded completion is never in the future.
        const m = cmd(interviews, 'interview.schedule', {
          scheduled_at: scheduled - (reschedule ? hour : 0),
          interviewer_name: '虚构专业面试官',
          note: '虚构预约，仅记录预约开始时间。'
        }).interviewId
        if (reschedule)
          cmd(interviews, 'interview.reschedule', {
            interview_id: m,
            interview_version: 1,
            scheduled_at: scheduled
          })
        if (status === 'completed') {
          date = Math.max(date, scheduled)
          cmd(interviews, 'interview.complete', {
            interview_id: m,
            interview_version: reschedule ? 2 : 1
          })
          if (evaluation) review(m, ['recommend', 'not_recommend', 'undecided'][slot % 3])
        }
        if (status === 'cancelled')
          cmd(interviews, 'interview.cancel', {
            interview_id: m,
            interview_version: 1,
            reason: '虚构：候选人取消本次预约'
          })
        return m
      }
      const complete = (evaluation, reschedule = false) =>
        meeting(
          'completed',
          Math.min(
            now,
            date + (date === applied ? (applied === today ? 2 + (i % 3) * 2 : 10) * hour : hour)
          ),
          evaluation,
          reschedule && date + hour < now
        )
      const skip = '虚构：HR 已复核岗位证据并记录缺评或免评原因'
      if (stage !== 'screening') {
        advance('first_interview')
        if (stage !== 'first_interview') {
          const mid = complete(n % 4 !== 0, active && n === 0)
          advance('second_interview', n % 4 === 0 ? skip : undefined)
          if (active && n === 0) review(mid, 'recommend', 'feedback.supplement')
          if (stage === 'offer') {
            const skipSecond = !active && n >= 14
            if (!skipSecond) complete(n % 3 !== 0)
            advance('offer', skipSecond || n % 3 === 0 ? skip : undefined)
          }
        }
      }
      if (stage === 'first_interview' || stage === 'second_interview') {
        if ((!active || n >= 7) && (active || n < (stage === 'first_interview' ? 13 : 10))) {
          if (n % 5 === 0) {
            meeting('cancelled', date + hour)
          } else if (n % 4 !== 0) {
            const mid = complete(n % 3 !== 1)
            if (active && n === 11) {
              cmd(feedback, 'feedback.correct', {
                interview_id: mid,
                feedback_revision: 1,
                recommendation: 'undecided',
                correction_reason: '虚构：复核后补充评分依据',
                reason: '虚构：跨团队案例仍需进一步确认。'
              })
            }
            if (active && n === 13) complete(true)
          }
        }
        if (active && n < 11) {
          const scheduled =
            n === 6
              ? dueSlots[stage === 'first_interview' ? 0 : 1]
              : scheduledSlots[(n < 6 ? n : n - 1) * 2 + (stage === 'second_interview' ? 1 : 0)]
          meeting('scheduled', Math.max(date, scheduled), false, n === 2)
        }
        if (!active && extraHistory < 17 && date <= historySlots[extraHistory]) {
          const scheduled = historySlots[extraHistory]
          const cancelled =
            extraHistory < recentHistoryCount ? extraHistory % 2 === 1 : extraHistory % 3 === 1
          extraHistory++
          // Use the same workflow and receipts, without adding feedback to these display samples.
          date = Math.max(date, scheduled - hour)
          meeting(cancelled ? 'cancelled' : 'completed', scheduled)
        }
      }
      if (stage === 'offer') {
        if (active ? n >= 2 : n < 26) {
          cmd(offers, 'offer.send')
          if (!active && n < 26 && bucket === 5) date = Math.max(date, monthStart(0))
          if ((!active && n < 17) || (active && n >= 6)) cmd(offers, 'offer.accept')
          if (!active && n < 17)
            cmd(offers, 'offer.confirmHire', { reason: '虚构：HR 独立核验并确认录用' })
          else if (!active && n < 26)
            cmd(offers, 'offer.decline', { reason: '虚构：候选人选择其他机会' })
        }
        if (!active && n < 26) continue
      }
      if (!active)
        cmd(offers, 'application.close', {
          outcome: n % 2 === 0 ? 'company_rejected' : 'candidate_withdrew',
          reason: n % 2 === 0 ? '虚构：岗位匹配度未达到要求' : '虚构：候选人主动退出'
        })
    }
  }
  for (const id of positions.slice(11, 19))
    run(now, recruiting, 'position.status', { status: 'closed' }, id)
  for (const id of [positions[18], positions[19]]) run(now, recruiting, 'position.delete', {}, id)

  const insert = db.prepare(
    'INSERT INTO legacy_records (source_key,entity_type,legacy_id,raw_json,facts_json,mapped_position_id,mapping_status,imported_at) VALUES (?,?,?,?,?,?,?,?)'
  )
  for (let i = 0; i < 10; i++) {
    const type = i < 6 ? 'candidates' : i < 8 ? 'positions' : 'interviews'
    const mapping =
      type === 'candidates' ? ['unique_match', 'no_match', 'ambiguous'][i % 3] : 'not_applicable'
    const raw = i === 0 ? { stage: 'rejected' } : i === 6 ? { status: 'closed' } : {}
    const facts =
      i === 0
        ? {
            application_status: 'closed',
            outcome: 'company_rejected',
            stage: null,
            offer_status: null
          }
        : i === 6
          ? { status: 'closed' }
          : {}
    insert.run(
      'fictional-demo-legacy',
      type,
      100 + i,
      JSON.stringify(raw),
      JSON.stringify(facts),
      mapping === 'unique_match' ? positions[i] : null,
      mapping,
      now
    )
  }
}
