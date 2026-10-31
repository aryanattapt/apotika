import { amount } from '../../../shared/domain/money'
import { canAccessPharmacy, type User } from '../../../shared/domain/access'

export type OrderReadModel = {
  order: any
  items: any[]
  prescriptions: any[]
  history: any[]
  payment: any | null
  fulfillmentCheck: any | null
}

export interface OrderReadRepository {
  findById(orderId: string): Promise<OrderReadModel | null>
}
export type GetOrderResult = { ok: true; order: Record<string, unknown> } | { ok: false; reason: 'not-found' | 'forbidden' }

export async function getOrderView(repository: OrderReadRepository, orderId: string, user: User): Promise<GetOrderResult> {
  const model = await repository.findById(orderId)
  if (!model) return { ok: false, reason: 'not-found' }
  const { order, items, prescriptions, history, payment, fulfillmentCheck } = model
  if (order.customer_id !== user.id && !canAccessPharmacy(user, order.pharmacy_id)) return { ok: false, reason: 'forbidden' }
  return {
    ok: true,
    order: {
      id: order.id,
      customerId: order.customer_id,
      pharmacyId: order.pharmacy_id,
      pharmacyName: order.pharmacy_name,
      reviewVersion: Number(order.review_version),
      pharmacyAddress: order.pharmacy_address,
      status: order.status,
      fulfillmentMethod: order.fulfillment_method,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        name: item.product_name_snapshot,
        sellUnit: item.sell_unit_snapshot,
        requiresPrescription: item.requires_prescription_snapshot,
        batchTrackingRequired: item.batch_tracking_required_snapshot,
        quantity: item.quantity,
        unitPrice: amount(item.unit_price),
        lineTotal: amount(item.line_total),
      })),
      totals: {
        subtotal: amount(order.subtotal),
        discount: amount(order.discount),
        shippingFee: amount(order.shipping_fee),
        serviceFee: amount(order.service_fee),
        total: amount(order.total),
      },
      expiresAt: order.expires_at,
      createdAt: order.created_at,
      prescriptions: prescriptions.map((prescription) => ({ id: prescription.id, status: prescription.status, revision: prescription.document_revision, uploadedAt: prescription.created_at })),
      payment: payment ? {
        id: payment.id,
        status: payment.status,
        amount: amount(payment.amount),
        receivedAmount: payment.received_amount == null ? null : amount(payment.received_amount),
        currency: payment.currency,
        expiresAt: payment.expires_at,
      } : null,
      fulfillmentCheck: fulfillmentCheck ? {
        passed: fulfillmentCheck.passed,
        pharmacistCheck: fulfillmentCheck.pharmacist_check,
        note: fulfillmentCheck.note,
        checkedAt: fulfillmentCheck.checked_at,
      } : null,
      pickupCode: order.customer_id === user.id && order.fulfillment_method === 'pickup' ? order.pickup_code : undefined,
      history: history.map((entry) => ({ from: entry.from_status, to: entry.to_status, reason: entry.reason, at: entry.created_at })),
    },
  }
}
