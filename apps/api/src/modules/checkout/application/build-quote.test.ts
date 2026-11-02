import { describe, expect, test } from 'bun:test'
import { buildQuoteSnapshot } from './build-quote'

type StockProduct = Parameters<typeof buildQuoteSnapshot>[0]['stock'][number]
const product = (overrides: Partial<StockProduct> = {}): StockProduct => ({
  id: 'product-1',
  sku: 'SKU-1',
  name: 'Vitamin C',
  sell_unit: 'botol',
  category: 'Vitamin',
  requires_prescription: false,
  batch_tracking_required: false,
  unit_price: '10.25',
  ...overrides,
})
function build(overrides: Partial<Parameters<typeof buildQuoteSnapshot>[0]> = {}) {
  return buildQuoteSnapshot({
    pharmacyId: 'pharmacy-1',
    fulfillmentMethod: 'pickup',
    address: null,
    cart: [{ productId: 'product-1', quantity: 2 }],
    stock: [product()],
    serviceFee: '1.25',
    ...overrides,
  })
}

describe('quote snapshot construction', () => {
  test('calculates item and order totals using integer cents', () => {
    const result = build()
    expect(result).not.toBeNull()
    expect(result?.items[0]).toMatchObject({
      productId: 'product-1',
      sku: 'SKU-1',
      name: 'Vitamin C',
      quantity: 2,
      unitPrice: '10.25',
      lineTotal: '20.50',
    })
    expect(result?.totals).toEqual({
      subtotal: '20.50',
      discount: '0.00',
      shippingFee: '0.00',
      serviceFee: '1.25',
      total: '21.75',
    })
  })

  test('adds shipping only for delivery and includes prescription flags', () => {
    const result = build({
      fulfillmentMethod: 'delivery',
      address: { recipientName: 'Arya', phone: '0812', addressText: 'Jl. Mawar', city: 'Jakarta', postalCode: '11840' },
      shippingFee: '4.50',
      cart: [
        { productId: 'product-1', quantity: 1 },
        { productId: 'product-2', quantity: 2 },
      ],
      stock: [product(), product({ id: 'product-2', requires_prescription: true, unit_price: '2.00' })],
    })
    expect(result?.totals.shippingFee).toBe('4.50')
    expect(result?.totals.subtotal).toBe('14.25')
    expect(result?.totals.total).toBe('20.00')
    expect(result?.needsPrescription).toBe(true)
  })

  test('ignores shipping fee for pickup and rejects missing or mismatched stock', () => {
    expect(build({ shippingFee: '99.99' })?.totals.shippingFee).toBe('0.00')
    expect(build({ stock: [] })).toBeNull()
    expect(build({ stock: [product({ id: 'other-product' })] })).toBeNull()
    expect(build({
      cart: [{ productId: 'one' }, { productId: 'two' }] as any,
      stock: [product()],
    })).toBeNull()
  })
})
