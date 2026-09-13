export type PositionStatus = 'open' | 'closed'

export interface PositionFormData {
  title: string
  department: string
  location: string
  status: PositionStatus
  description: string
}

export interface Position extends PositionFormData {
  id: number
  candidateCount: number
  publishDate: string
}
