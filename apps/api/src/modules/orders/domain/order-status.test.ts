import { describe, expect, test } from 'bun:test'
import { canTransitionOrder, isOrderStatus } from './order-status'

describe('order lifecycle domain', () => {
  test('allows valid forward transitions', () => {
    expect(canTransitionOrder('awaiting_prescription', 'awaiting_payment')).toBe(true)
    expect(canTransitionOrder('paid', 'processing')).toBe(true)
    expect(canTransitionOrder('ready', 'completed')).toBe(true)
    expect(canTransitionOrder('processing', 'cancelled')).toBe(true)
  })

  test('rejects invalid and terminal-state transitions', () => {
    expect(canTransitionOrder('awaiting_payment', 'completed')).toBe(false)
    expect(canTransitionOrder('completed', 'cancelled')).toBe(false)
    expect(canTransitionOrder('unknown', 'paid')).toBe(false)
    expect(isOrderStatus('paid')).toBe(true)
    expect(isOrderStatus('refunded')).toBe(false)
  })
})
