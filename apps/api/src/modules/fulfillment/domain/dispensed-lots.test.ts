import { describe, expect, test } from 'bun:test'
import { parseDispensedLots } from './dispensed-lots'

describe('dispensed lot domain', () => {
  test('accepts valid lots whose quantities match the order item', () => {
    expect(
      parseDispensedLots(
        [
          { lotNumber: 'A-1', expiresOn: '2027-01-31', quantity: 2 },
          { lotNumber: 'A-2', expiresOn: '2027-02-28', quantity: 1 },
        ],
        3,
      ),
    ).toEqual({
      ok: true,
      lots: [
        { lotNumber: 'A-1', expiresOn: '2027-01-31', quantity: 2 },
        { lotNumber: 'A-2', expiresOn: '2027-02-28', quantity: 1 },
      ],
    })
  })

  test('rejects missing, malformed, and quantity-mismatched lot records', () => {
    expect(parseDispensedLots([], 1)).toEqual({ ok: false, reason: 'required' })
    expect(
      parseDispensedLots([{ lotNumber: 'A-1', expiresOn: '2027-02-30', quantity: 1 }], 1),
    ).toEqual({ ok: false, reason: 'invalid' })
    expect(
      parseDispensedLots([{ lotNumber: 'A-1', expiresOn: '2027-02-28', quantity: 1 }], 2),
    ).toEqual({ ok: false, reason: 'quantity-mismatch' })
  })
})
