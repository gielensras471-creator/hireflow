import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Candidate } from '@/types/candidate'

export const useCandidateStore = defineStore('candidate', () => {
  const candidates = ref<Candidate[]>([
    {
      id: 1,
      name: '陈晓',
      position: '前端开发工程师',
      education: '本科',
      school: '深圳大学',
      phone: '13800000001',
      email: 'chenxiao@example.com',
      stage: 'first_interview',
      owner: '张经理',
      skills: 'Vue3、TypeScript、JavaScript',
      experience: '参与企业后台管理系统前端开发。',
      note: '沟通能力较好，前端基础扎实。',
      appliedDate: '2026-09-10'
    },
    {
      id: 2,
      name: '林悦',
      position: 'UI 设计师',
      education: '本科',
      school: '广州美术学院',
      phone: '13800000002',
      email: 'linyue@example.com',
      stage: 'screening',
      owner: '李主管',
      skills: 'Figma、Photoshop、UI设计',
      experience: '有移动端及 Web 产品设计经验。',
      note: '作品集视觉表现较好。',
      appliedDate: '2026-09-09'
    },
    {
      id: 3,
      name: '王晨',
      position: '产品助理',
      education: '本科',
      school: '暨南大学',
      phone: '13800000003',
      email: 'wangchen@example.com',
      stage: 'offer',
      owner: '赵经理',
      skills: 'Axure、需求分析、项目协作',
      experience: '有互联网产品实习经历。',
      note: '已进入 Offer 阶段。',
      appliedDate: '2026-09-06'
    },
    {
      id: 4,
      name: '周航',
      position: 'Java 后端工程师',
      education: '本科',
      school: '广东工业大学',
      phone: '13800000004',
      email: 'zhouhang@example.com',
      stage: 'second_interview',
      owner: '张经理',
      skills: 'Java、Spring Boot、MySQL',
      experience: '有 Spring Boot 项目开发经验。',
      note: '技术面表现稳定。',
      appliedDate: '2026-09-08'
    },
    {
      id: 5,
      name: '黄欣',
      position: '测试工程师',
      education: '本科',
      school: '华南农业大学',
      phone: '13800000005',
      email: 'huangxin@example.com',
      stage: 'screening',
      owner: '陈主管',
      skills: '功能测试、接口测试、Postman',
      experience: '参与多个 Web 项目测试。',
      note: '等待简历进一步评估。',
      appliedDate: '2026-09-07'
    },
    {
      id: 6,
      name: '刘洋',
      position: '前端开发工程师',
      education: '本科',
      school: '广州大学',
      phone: '13800000006',
      email: 'liuyang@example.com',
      stage: 'rejected',
      owner: '张经理',
      skills: 'Vue2、JavaScript、CSS',
      experience: '有后台系统开发经验。',
      note: '当前能力与岗位要求存在差距。',
      appliedDate: '2026-09-04'
    },
    {
      id: 7,
      name: '郑可',
      position: '运营专员',
      education: '本科',
      school: '广东财经大学',
      phone: '13800000007',
      email: 'zhengke@example.com',
      stage: 'first_interview',
      owner: '王主管',
      skills: '活动运营、数据分析、文案',
      experience: '有社区运营实习经历。',
      note: '已安排初面。',
      appliedDate: '2026-09-03'
    }
  ])

  const getCandidateById = (id: number) => {
    return candidates.value.find((item) => item.id === id)
  }

  return {
    candidates,
    getCandidateById
  }
})
