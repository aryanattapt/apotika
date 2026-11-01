import { describe, expect, test } from 'bun:test'
import {
  allRequiredItemsApproved,
  isPrescriptionDecision,
  validateReviewItems,
} from './review-policy'

describe('prescription review domain', () => {
  test('requires every prescription item to be included in an approval', () => {
    expect(validateReviewItems(['item-1', 'item-2'], ['item-1'], 'approved')).toEqual({
      ok: false,
      reason: 'incomplete',
    })
    expect(validateReviewItems(['item-1', 'item-2'], ['item-1', 'item-2'], 'approved')).toEqual({
      ok: true,
      itemIds: ['item-1', 'item-2'],
    })
  })

  test('rejects empty or foreign review item selections', () => {
    expect(validateReviewItems(['item-1'], [], 'rejected')).toEqual({ ok: false, reason: 'empty' })
    expect(validateReviewItems(['item-1'], ['foreign-item'], 'clarification')).toEqual({
      ok: false,
      reason: 'unknown-item',
    })
    expect(isPrescriptionDecision('approved')).toBe(true)
    expect(isPrescriptionDecision('pending')).toBe(false)
  })

  test('only resolves the order when every required item has the current approved revision', () => {
    const reviews = [
      { itemId: 'item-1', decision: 'approved', documentRevision: 2 },
      { itemId: 'item-2', decision: 'approved', documentRevision: 1 },
    ]
    expect(allRequiredItemsApproved(['item-1', 'item-2'], reviews, 2)).toBe(false)
    expect(allRequiredItemsApproved(['item-1'], [reviews[0]!], 2)).toBe(true)
  })
})
