import {
  checkBillingEligibility,
  checkRefundEligibility,
  requestPaymentRefund,
  startOrderPayment,
} from './application/payment.service'
import type { RefundRequestDto } from './application/payment.dto'
import { PostgresPaymentRepository } from './infrastructure/payment.repository'

const repository = new PostgresPaymentRepository()

export const checkOrderBilling = (orderId: string, customerId: string) =>
  checkBillingEligibility(repository, orderId, customerId)
export const checkPaymentRefund = (paymentId: string, amount: number) =>
  checkRefundEligibility(repository, paymentId, amount)
export const beginOrderPayment = (orderId: string, customerId: string) =>
  startOrderPayment(repository, orderId, customerId)
export const submitPaymentRefund = (paymentId: string, input: RefundRequestDto) =>
  requestPaymentRefund(repository, paymentId, input)
