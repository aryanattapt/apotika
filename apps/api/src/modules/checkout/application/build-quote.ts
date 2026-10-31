import { amount, cents, money } from '../../../shared/domain/money'
import type { CartItem } from '../domain/cart'
import { quoteFingerprint } from '../domain/quote-fingerprint'

type StockProduct = {
  id: string
  sku: string
  name: string
  sell_unit: string
  category: string
  requires_prescription: boolean
  batch_tracking_required: boolean
  unit_price: string | number
}

type QuoteAddress = { recipientName: string; phone: string; addressText: string; city: string; postalCode: string } | null
type QuoteTotals = { subtotal: string; discount: string; shippingFee: string; serviceFee: string; total: string }

export type QuoteSnapshot = {
  items: Array<{
    productId: string
    sku: string
    name: string
    sellUnit: string
    requiresPrescription: boolean
    batchTrackingRequired: boolean
    quantity: number
    unitPrice: string
    lineTotal: string
  }>
  totals: QuoteTotals
  needsPrescription: boolean
  fingerprint: string
}

/** Build the immutable, customer-visible quote snapshot from validated cart and current stock rows. */
export function buildQuoteSnapshot(input: {
  pharmacyId: string
  fulfillmentMethod: 'pickup' | 'delivery'
  address: QuoteAddress
  cart: CartItem[]
  stock: StockProduct[]
  shippingFee?: string | number | null
  serviceFee: string | number
}): QuoteSnapshot | null {
  if (input.cart.length !== input.stock.length) return null
  const items = input.cart.map((cartItem) => {
    const product = input.stock.find((row) => row.id === cartItem.productId)
    if (!product) return null
    const unitPrice = amount(product.unit_price)
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      sellUnit: product.sell_unit,
      requiresPrescription: product.requires_prescription,
      batchTrackingRequired: product.batch_tracking_required,
      quantity: cartItem.quantity,
      unitPrice,
      lineTotal: money(cents(unitPrice) * cartItem.quantity),
    }
  })
  if (items.some((item) => item === null)) return null

  const itemSnapshots = items as NonNullable<(typeof items)[number]>[]
  const subtotalCents = itemSnapshots.reduce((sum, item) => sum + cents(item.lineTotal), 0)
  const shippingCents = input.fulfillmentMethod === 'delivery' ? cents(input.shippingFee ?? 0) : 0
  const totals = {
    subtotal: money(subtotalCents),
    discount: '0.00',
    shippingFee: money(shippingCents),
    serviceFee: amount(input.serviceFee),
    total: money(subtotalCents + shippingCents + cents(input.serviceFee)),
  }
  return {
    items: itemSnapshots,
    totals,
    needsPrescription: itemSnapshots.some((item) => item.requiresPrescription),
    fingerprint: quoteFingerprint(input.pharmacyId, input.fulfillmentMethod, input.address, itemSnapshots, totals),
  }
}
