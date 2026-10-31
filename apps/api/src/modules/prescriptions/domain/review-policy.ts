export const PRESCRIPTION_DECISIONS = ['approved', 'clarification', 'rejected'] as const
export type PrescriptionDecision = (typeof PRESCRIPTION_DECISIONS)[number]

export function isPrescriptionDecision(value: unknown): value is PrescriptionDecision {
  return typeof value === 'string' && (PRESCRIPTION_DECISIONS as readonly string[]).includes(value)
}

export type ReviewItemsResult = { ok: true; itemIds: string[] } | { ok: false; reason: 'empty' | 'unknown-item' | 'incomplete' }

export function validateReviewItems(requiredItemIds: readonly string[], input: unknown, decision: PrescriptionDecision): ReviewItemsResult {
  const supplied = Array.isArray(input) ? [...new Set(input.map(String))] : []
  if (!supplied.length) return { ok: false, reason: 'empty' }
  if (supplied.some((id) => !requiredItemIds.includes(id))) return { ok: false, reason: 'unknown-item' }
  if (decision === 'approved' && requiredItemIds.some((id) => !supplied.includes(id))) return { ok: false, reason: 'incomplete' }
  return { ok: true, itemIds: supplied }
}

export type LatestReview = { itemId: string; decision: string | null; documentRevision: number | null }

export function allRequiredItemsApproved(requiredItemIds: readonly string[], latestReviews: readonly LatestReview[], currentDocumentRevision: number): boolean {
  if (!requiredItemIds.length) return false
  const byItem = new Map(latestReviews.map((review) => [review.itemId, review]))
  return requiredItemIds.every((itemId) => {
    const review = byItem.get(itemId)
    return review?.decision === 'approved' && review.documentRevision === currentDocumentRevision
  })
}
