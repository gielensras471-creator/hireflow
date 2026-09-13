export type CandidateStage =
  | 'screening'
  | 'first_interview'
  | 'second_interview'
  | 'offer'
  | 'rejected'

export interface CandidateFormData {
  name: string
  position: string
  education: string
  school: string
  phone: string
  email: string
  stage: CandidateStage
  owner: string
  skills: string
  experience: string
  note: string
}

export interface Candidate extends CandidateFormData {
  id: number
  appliedDate: string
}
