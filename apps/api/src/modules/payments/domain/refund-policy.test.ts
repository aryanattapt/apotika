import { describe, expect, test } from 'bun:test'
import { canRequestRefund } from './refund-policy'

describe('refund policy', () => {
  test('accounts for requested refunds before accepting another amount', () => {
    expect(
      canRequestRefund({
        receivedAmount: '100.00',
        alreadyRequestedAmount: '40.00',
        requestedAmount: '60.00',
      }),
    ).toBe(true)
    expect(
      canRequestRefund({
        receivedAmount: '100.00',
        alreadyRequestedAmount: '40.00',
        requestedAmount: '60.01',
      }),
    ).toBe(false)
  })

  test('rejects non-positive or unreceived refund amounts', () => {
    expect(
      canRequestRefund({ receivedAmount: null, alreadyRequestedAmount: 0, requestedAmount: 1 }),
    ).toBe(false)
    expect(
      canRequestRefund({ receivedAmount: 100, alreadyRequestedAmount: 0, requestedAmount: 0 }),
    ).toBe(false)
  })
})
