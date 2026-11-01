export type PrescriptionReviewRequestDto = {
  decision?: string
  reason?: string
  expectedReviewVersion?: number | string
  orderItemIds?: unknown
}

export type PrescriptionMessageRequestDto = {
  message?: string
}
