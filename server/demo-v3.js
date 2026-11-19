import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { openDatabase } from './db/database.js'
import { createV3Schema } from './db/schema-v3.js'
import { createRecruitingService } from './services/recruiting-service.js'
import { createAdvancementService } from './services/advancement-service.js'
import { createInterviewService } from './services/interview-service.js'
import { createFeedbackService } from './services/feedback-service.js'
import { createOfferService } from './services/offer-service.js'

// This factory cannot accept a database path or an existing connection.
export function createDemoDatabase(password) {
  if (typeof password !== 'string' || password.length < 7 || Buffer.byteLength(password) > 72)
    throw new Error('A demo password of 7+ characters and at most 72 bytes is required')
  const db = openDatabase(':memory:')
  try {
    createV3Schema(db)
    db.prepare(
      'INSERT INTO users (username,password_hash,name,role,department,email,phone) VALUES (?,?,?,?,?,?,?)'
    ).run(
      'demo_admin',
      bcrypt.hashSync(password, 10),
      '招聘管理员（演示）',
      'hr',
      '虚构演示团队',
      '',
      ''
    )
    const context = Object.freeze({})
    const options = { db, resolveActor: (c) => (c === context ? 1 : undefined) }
    const recruiting = createRecruitingService(options)
    const advancement = createAdvancementService(options)
    const interviews = createInterviewService(options)
    const feedback = createFeedbackService(options)
    const offers = createOfferService(options)
    const run = (service, command, payload, aggregateId) =>
      service.execute(context, {
        command,
        payload,
        idempotencyKey: randomUUID(),
        ...(aggregateId
          ? {
              aggregateId,
              expectedVersion: db
                .prepare('SELECT version FROM candidates WHERE id=?')
                .get(aggregateId).version
            }
          : {})
      }).result
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date())
    const roles = [
      ['前端开发工程师', '研发', 'Vue、TypeScript、可访问性与组件测试'],
      ['后端开发工程师', '研发', 'Node.js、SQL、事务和接口设计'],
      ['UI/UX 设计师', '设计', '交互原型、设计规范和可用性研究'],
      ['产品经理', '产品', '需求分析、流程建模与跨团队协作'],
      ['测试工程师', '质量', 'API 自动化、边界测试与缺陷分析'],
      ['数据分析师', '数据', 'SQL、指标定义和数据可视化']
    ]
    const positions = roles.map(
      ([title, department, skills]) =>
        run(recruiting, 'position.create', {
          title: '[虚构演示] ' + title,
          department,
          location: '虚构星桥团队 · 线上',
          publish_date: today,
          description: '虚构招聘展示；岗位要求：' + skills + '。请勿提交真实个人资料。'
        }).aggregateId
    )
    const advance = (id, target_stage, reason) =>
      run(advancement, 'application.advance', { target_stage, ...(reason ? { reason } : {}) }, id)
    const close = (id, outcome, reason) => run(offers, 'application.close', { outcome, reason }, id)
    const review = (id, mid, command = 'feedback.submit', recommendation = 'recommend') =>
      run(
        feedback,
        command,
        {
          interview_id: mid,
          reviewer_name: '虚构专业面试官',
          recommendation,
          reason:
            recommendation === 'recommend'
              ? '虚构：专业案例表达清楚，符合本轮岗位要求'
              : '虚构：本轮专业能力与岗位要求尚有差距'
        },
        id
      )
    const meeting = (id, status = 'completed', evaluated = true) => {
      const m = run(
        interviews,
        'interview.schedule',
        {
          scheduled_at: Date.now() + (status === 'scheduled' ? 3600000 : 0),
          interviewer_name: '虚构专业面试官',
          note: '虚构演示面试；时间为本次初始化实际登记时间'
        },
        id
      )
      if (status === 'cancelled')
        run(
          interviews,
          'interview.cancel',
          { interview_id: m.interviewId, interview_version: 1, reason: '虚构：候选人申请调整计划' },
          id
        )
      if (status === 'completed') {
        run(
          interviews,
          'interview.complete',
          { interview_id: m.interviewId, interview_version: 1 },
          id
        )
        if (evaluated) review(id, m.interviewId)
      }
      return m.interviewId
    }
    const names = ['林澄', '陈序', '周禾', '许知', '宋遥', '顾宁', '陆言', '唐予']
    for (let i = 0; i < 32; i++) {
      const role = i % 6
      const id = run(recruiting, 'application.create', {
        position_id: positions[role],
        name: '[虚构演示] ' + names[i % 8] + String(i + 1).padStart(2, '0'),
        owner: '招聘管理员（演示）',
        applied_date: today,
        education: '本科（虚构）',
        school: '虚构星桥学院',
        email: 'candidate' + (i + 1) + '@example.invalid',
        skills: roles[role][2],
        experience:
          '虚构经历：参与' + roles[role][0] + '相关项目，负责需求分析、方案执行及结果复盘。',
        note: '全部资料为虚构；公开共享空间，请勿录入真实信息。'
      }).aggregateId
      if (i < 14) {
        if (i === 12) close(id, 'company_rejected', '虚构：筛选后岗位经验不匹配')
        if (i === 13) close(id, 'candidate_withdrew', '虚构：候选人主动退出')
        continue
      }
      advance(id, 'first_interview')
      if (i < 22) {
        meeting(id, i < 17 ? 'scheduled' : i === 21 ? 'cancelled' : 'completed', i !== 20)
        continue
      }
      if (i < 26) {
        if (i === 25) {
          advance(id, 'second_interview', '虚构：HR核实项目经历后免除初面评价')
          continue
        }
        const first = meeting(id, 'completed', i !== 23)
        advance(
          id,
          'second_interview',
          i === 23 ? '虚构：已完成初面，评价人稍后补录原始依据' : undefined
        )
        if (i === 23) review(id, first, 'feedback.supplement')
        const second = meeting(id, i === 22 ? 'scheduled' : 'completed', i !== 24)
        if (i === 24) {
          review(id, second, 'feedback.submit', 'not_recommend')
          close(id, 'company_rejected', '虚构：复面专业能力不符合当前岗位要求')
        }
        continue
      }
      // Six Offer samples: preparing, sent, accepted, hired, declined, company rejected.
      if (i === 29) {
        meeting(id)
        advance(id, 'second_interview')
        meeting(id)
        advance(id, 'offer')
      } else {
        if (i === 27 || i === 28) meeting(id)
        advance(
          id,
          'second_interview',
          i === 27 || i === 28 ? undefined : '虚构：HR核实作品集后免除初面评价'
        )
        advance(id, 'offer', '虚构：HR记录复面评价豁免，以展示独立Offer操作')
      }
      if (i >= 27) run(offers, 'offer.send', {}, id)
      if (i === 28 || i === 29) run(offers, 'offer.accept', {}, id)
      if (i === 29)
        run(offers, 'offer.confirmHire', { reason: '虚构：HR独立确认录用，完整招聘结案' }, id)
      if (i === 30)
        run(offers, 'offer.decline', { reason: '虚构：候选人接受其他机会，拒绝Offer' }, id)
      if (i === 31) close(id, 'company_rejected', '虚构：企业调整岗位计划，结束本次申请')
    }
    return { db, jwtSecret: randomBytes(48).toString('hex') }
  } catch (error) {
    db.close()
    throw error
  }
}
