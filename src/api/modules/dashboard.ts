import { getPositionListApi } from '@/api/modules/position'

import { getCandidateListApi } from '@/api/modules/candidate'

import { getInterviewListApi } from '@/api/modules/interview'

export const getDashboardDataApi = async () => {
  const [positions, candidates, interviews] = await Promise.all([
    getPositionListApi(),
    getCandidateListApi(),
    getInterviewListApi()
  ])

  return {
    positions,
    candidates,
    interviews
  }
}
