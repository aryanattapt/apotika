export type CancellationRequestDto = {
  reason?: string
}

export type CancellationDecisionDto = {
  decision?: string
  reason?: string
}

export type CreateSupportCaseDto = {
  description?: string
  category?: string
}

export type UpdateSupportCaseDto = {
  status: string
  assignedTo?: string
}
