import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../../infrastructure/database/client'
import { orders, payments, refunds } from '../../../infrastructure/database/schema'
import type { PaymentRepository } from '../application/payment.service'

export class PostgresPaymentRepository implements PaymentRepository {
  async findOrderForBilling(orderId: string) {
    const [order] = await db
      .select({
        customerId: orders.customerId,
        status: orders.status,
        expiresAt: orders.expiresAt,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    return order ?? null
  }

  async findRefundPayment(paymentId: string) {
    const [payment] = await db
      .select({
        id: payments.id,
        status: payments.status,
        receivedAmount: payments.receivedAmount,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
    return payment ?? null
  }

  async getRequestedRefundAmount(paymentId: string) {
    const [refund] = await db
      .select({
        amount: sql<string>`COALESCE(SUM(${refunds.amount}), 0)`,
      })
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, paymentId),
          inArray(refunds.status, ['requested', 'processing', 'succeeded']),
        ),
      )
    return refund.amount
  }
}
