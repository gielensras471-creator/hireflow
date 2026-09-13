export type InterviewStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'

export interface InterviewFormData {
  candidateId: number
  candidateName: string
  position: string
  date: string
  time: string
  interviewer: string
  type: string
  note: string
}

export interface Interview extends InterviewFormData {
  id: number
  status: InterviewStatus
}
