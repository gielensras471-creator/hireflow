import type { CandidateStage } from '@/types/candidate'

export type CandidateStageTagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

interface CandidateStageConfig {
  label: string
  tagType: CandidateStageTagType
  nextStage: CandidateStage | null
  nextActionLabel: string | null
  progressLevel: number
}

export const candidateStageConfig: Record<CandidateStage, CandidateStageConfig> = {
  screening: {
    label: '筛选中',
    tagType: 'info',
    nextStage: 'first_interview',
    nextActionLabel: '推进到初面',
    progressLevel: 0
  },

  first_interview: {
    label: '初面',
    tagType: 'warning',
    nextStage: 'second_interview',
    nextActionLabel: '推进到复面',
    progressLevel: 1
  },

  second_interview: {
    label: '复面',
    tagType: 'primary',
    nextStage: 'offer',
    nextActionLabel: '推进到 Offer',
    progressLevel: 2
  },

  offer: {
    label: 'Offer',
    tagType: 'success',
    nextStage: null,
    nextActionLabel: null,
    progressLevel: 3
  },

  rejected: {
    label: '已淘汰',
    tagType: 'danger',
    nextStage: null,
    nextActionLabel: null,
    progressLevel: 0
  }
}

export const getCandidateStageLabel = (stage: CandidateStage) => {
  return candidateStageConfig[stage].label
}

export const getCandidateStageTagType = (stage: CandidateStage) => {
  return candidateStageConfig[stage].tagType
}

export const getNextCandidateStage = (stage: CandidateStage) => {
  return candidateStageConfig[stage].nextStage
}

export const getNextCandidateStageActionLabel = (stage: CandidateStage) => {
  return candidateStageConfig[stage].nextActionLabel
}

export const getCandidateStageProgress = (stage: CandidateStage) => {
  return candidateStageConfig[stage].progressLevel
}

export const canAdvanceCandidateStage = (stage: CandidateStage) => {
  return candidateStageConfig[stage].nextStage !== null
}

export const canRejectCandidate = (stage: CandidateStage) => {
  return stage !== 'offer' && stage !== 'rejected'
}

export const canArrangeInterview = (stage: CandidateStage) => {
  return stage !== 'offer' && stage !== 'rejected'
}

/**
 * 安排首次面试时的自动阶段变化。
 *
 * 筛选中
 * → 安排面试
 * → 初面
 */
export const getStageAfterInterviewScheduled = (stage: CandidateStage): CandidateStage | null => {
  if (stage === 'screening') {
    return 'first_interview'
  }

  return null
}

/**
 * 面试完成后的自动阶段变化。
 *
 * 初面完成：
 * first_interview → second_interview
 *
 * 复面完成：
 * second_interview → offer
 */
export const getInterviewCompletionNextStage = (
  stage: CandidateStage,
  interviewType: string
): CandidateStage | null => {
  if (stage === 'first_interview' && interviewType === '初面') {
    return 'second_interview'
  }

  if (stage === 'second_interview' && interviewType === '复面') {
    return 'offer'
  }

  return null
}
