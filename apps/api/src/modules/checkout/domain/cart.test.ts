import { describe, expect, test } from 'bun:test'
import { buildQuoteSnapshot } from '../application/build-quote'
import { parseCartItems } from './cart'

const FIRST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SECOND_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('checkout cart domain', () => {
  test('normalizes and sorts unique product lines', () => {
    expect(parseCartItems([
      { productId: SECOND_ID, quantity: '2' },
      { productId: FIRST_ID, quantity: 1 },
    ])).toEqual({
      ok: true,
      items: [{ productId: FIRST_ID, quantity: 1 }, { productId: SECOND_ID, quantity: 2 }],
    })
  })

  test('rejects duplicate product IDs and invalid quantities', () => {
    expect(parseCartItems([{ productId: FIRST_ID, quantity: 1 }, { productId: FIRST_ID, quantity: 2 }])).toEqual({ ok: false, reason: 'DUPLICATE_PRODUCT' })
    expect(parseCartItems([{ productId: FIRST_ID, quantity: 21 }])).toEqual({ ok: false, reason: 'INVALID_ITEM' })
    expect(parseCartItems([])).toEqual({ ok: false, reason: 'INVALID_LENGTH' })
  })

  test('builds a stable quote snapshot using integer cents', () => {
    const snapshot = buildQuoteSnapshot({
      pharmacyId: 'pharmacy-1',
      fulfillmentMethod: 'delivery',
      address: { recipientName: 'Arya', phone: '0812', addressText: 'Jl. Mawar', city: 'Jakarta', postalCode: '11840' },
      cart: [{ productId: FIRST_ID, quantity: 3 }],
      stock: [{ id: FIRST_ID, sku: 'OBT-1', name: 'Obat', sell_unit: 'box', category: 'obat', requires_prescription: false, batch_tracking_required: false, unit_price: '10.25' }],
      shippingFee: '5.50',
      serviceFee: '1.25',
    })

    expect(snapshot?.items[0]?.lineTotal).toBe('30.75')
    expect(snapshot?.totals).toEqual({ subtotal: '30.75', discount: '0.00', shippingFee: '5.50', serviceFee: '1.25', total: '37.50' })
    expect(snapshot?.needsPrescription).toBe(false)
    expect(snapshot?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})
