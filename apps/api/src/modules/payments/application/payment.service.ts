import { canRequestRefund } from '../domain/refund-policy'
import { ApplicationError } from '../../../shared/application-error'
import type { RefundRequestDto } from './payment.dto'

export interface PaymentRepository {
  findOrderForBilling(
    orderId: string,
  ): Promise<{ customerId: string; status: string; expiresAt: Date } | null>
  findRefundPayment(
    paymentId: string,
  ): Promise<{ id: string; status: string; receivedAmount: string | null } | null>
  getRequestedRefundAmount(paymentId: string): Promise<string>
}

export type PaymentCheckResult =
  | { ok: true }
  | {
      ok: false
      reason: 'not-found' | 'invalid-order-state' | 'payment-not-received' | 'refund-limit-exceeded'
    }

export async function checkBillingEligibility(
  repository: PaymentRepository,
  orderId: string,
  customerId: string,
): Promise<PaymentCheckResult> {
  const order = await repository.findOrderForBilling(orderId)
  if (!order || order.customerId !== customerId) return { ok: false, reason: 'not-found' }
  if (order.status !== 'awaiting_payment' || order.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'invalid-order-state' }
  }
  return { ok: true }
}

export async function checkRefundEligibility(
  repository: PaymentRepository,
  paymentId: string,
  requestedAmount: number,
): Promise<PaymentCheckResult> {
  const payment = await repository.findRefundPayment(paymentId)
  if (!payment) return { ok: false, reason: 'not-found' }
  if (!['succeeded', 'late'].includes(payment.status) || payment.receivedAmount == null) {
    return { ok: false, reason: 'payment-not-received' }
  }
  const alreadyRequestedAmount = await repository.getRequestedRefundAmount(paymentId)
  if (
    !canRequestRefund({
      receivedAmount: payment.receivedAmount,
      alreadyRequestedAmount,
      requestedAmount,
    })
  ) {
    return { ok: false, reason: 'refund-limit-exceeded' }
  }
  return { ok: true }
}

export async function startOrderPayment(
  repository: PaymentRepository,
  orderId: string,
  customerId: string,
): Promise<never> {
  const eligibility = await checkBillingEligibility(repository, orderId, customerId)
  if (!eligibility.ok && eligibility.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  if (!eligibility.ok)
    throw new ApplicationError(
      409,
      'INVALID_ORDER_STATE',
      'Pesanan belum memenuhi syarat untuk tagihan.',
    )
  throw new ApplicationError(
    503,
    'PAYMENT_PROVIDER_NOT_CONFIGURED',
    'Penyedia pembayaran belum dipilih dan dikonfigurasi. Pesanan tetap aman; hubungi operasional untuk menyiapkan integrasi.',
  )
}

export async function requestPaymentRefund(
  repository: PaymentRepository,
  paymentId: string,
  input: RefundRequestDto,
): Promise<never> {
  const requestedAmount = Number(input.amount)
  const reason = String(input.reason ?? '').trim()
  if (
    !Number.isFinite(requestedAmount) ||
    requestedAmount <= 0 ||
    reason.length < 3 ||
    reason.length > 500
  )
    throw new ApplicationError(400, 'INVALID_REFUND', 'Nominal dan alasan refund diperlukan.')
  const eligibility = await checkRefundEligibility(repository, paymentId, requestedAmount)
  if (!eligibility.ok && eligibility.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Pembayaran tidak ditemukan.')
  if (!eligibility.ok && eligibility.reason === 'payment-not-received')
    throw new ApplicationError(
      409,
      'PAYMENT_NOT_RECEIVED',
      'Dana terverifikasi belum tersedia untuk refund.',
    )
  if (!eligibility.ok)
    throw new ApplicationError(
      409,
      'REFUND_LIMIT_EXCEEDED',
      'Nominal refund melebihi dana yang diterima.',
    )
  throw new ApplicationError(
    503,
    'PAYMENT_PROVIDER_NOT_CONFIGURED',
    'Adapter refund belum dikonfigurasi. Permintaan belum dikirim dan dana belum berubah.',
  )
}
