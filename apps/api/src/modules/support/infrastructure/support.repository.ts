import { desc, eq } from 'drizzle-orm'
import { db, transaction } from '../../../infrastructure/database/client'
import { orders, supportCases } from '../../../infrastructure/database/schema'
import { recordAudit } from '../../platform'
import { canTransitionOrder, insertOrderStatusHistory } from '../../orders'
import type {
  CancellationDecisionDto,
  CreateSupportCaseDto,
  UpdateSupportCaseDto,
} from '../application/support.dto'
import type { SupportRepository } from '../application/support.service'

export class PostgresSupportRepository implements SupportRepository {
  requestCancellation(orderId: string, actorId: string, reason: string, canModerate: boolean) {
    return transaction(async (client) => {
      const order = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])
      if (!order.rowCount) return { ok: false, reason: 'not-found' as const }
      if (order.rows[0].customer_id !== actorId && !canModerate)
        return { ok: false, reason: 'forbidden' as const }
      if (
        !['awaiting_prescription', 'awaiting_payment', 'paid', 'processing', 'ready'].includes(
          order.rows[0].status,
        )
      )
        return { ok: false, reason: 'cancellation-not-allowed' as const }
      const existing = await client.query(
        "SELECT id,status FROM cancellation_requests WHERE order_id=$1 AND status='requested'",
        [orderId],
      )
      if (existing.rowCount) return { ok: true, value: existing.rows[0] }
      const saved = await client.query(
        'INSERT INTO cancellation_requests(order_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id,status',
        [orderId, actorId, reason],
      )
      await recordAudit(client, actorId, 'cancellation.requested', 'order', orderId, {
        requestId: saved.rows[0].id,
      })
      return { ok: true, value: saved.rows[0] }
    })
  }

  decideCancellation(requestId: string, actorId: string, input: CancellationDecisionDto) {
    return transaction(async (client) => {
      const request = await client.query(
        'SELECT cr.*,o.status AS order_status,o.pharmacy_id FROM cancellation_requests cr JOIN orders o ON o.id=cr.order_id WHERE cr.id=$1 FOR UPDATE OF cr,o',
        [requestId],
      )
      if (!request.rowCount) return { ok: false, reason: 'not-found' as const }
      if (request.rows[0].status !== 'requested')
        return { ok: false, reason: 'already-decided' as const }
      const approved = input.decision === 'approved'
      if (!approved && input.decision !== 'rejected')
        return { ok: false, reason: 'invalid-decision' as const }
      if (approved && !canTransitionOrder(request.rows[0].order_status, 'cancelled'))
        return { ok: false, reason: 'cancellation-not-allowed' as const }
      const status = approved ? 'approved' : 'rejected'
      await client.query(
        'UPDATE cancellation_requests SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now() WHERE id=$1',
        [requestId, status, actorId, String(input.reason ?? '').slice(0, 500) || null],
      )
      if (approved) {
        const orderId = request.rows[0].order_id
        const active = await client.query(
          "SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",
          [orderId],
        )
        for (const reservation of active.rows) {
          await client.query("UPDATE stock_reservations SET status='released' WHERE id=$1", [
            reservation.id,
          ])
          await client.query(
            'UPDATE inventory SET reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',
            [reservation.pharmacy_id, reservation.product_id, reservation.quantity],
          )
        }
        await client.query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1", [
          orderId,
        ])
        await insertOrderStatusHistory(
          client,
          orderId,
          request.rows[0].order_status,
          'cancelled',
          actorId,
          'Pembatalan disetujui',
        )
        if (['paid', 'processing', 'ready'].includes(request.rows[0].order_status)) {
          await client.query(
            "INSERT INTO support_cases(order_id,opened_by,category,description) SELECT $1,$2,'refund','Pembatalan disetujui; proses refund perlu ditangani finance.'",
            [orderId, actorId],
          )
        }
      }
      await recordAudit(
        client,
        actorId,
        'cancellation.decided',
        'cancellation_request',
        requestId,
        {
          decision: status,
        },
      )
      return { ok: true, value: { id: requestId, status } }
    })
  }

  async findOrderForCases(orderId: string) {
    const [order] = await db
      .select({
        customer_id: orders.customerId,
        pharmacy_id: orders.pharmacyId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    return order ?? null
  }

  async listCases(orderId: string) {
    const items = await db
      .select({
        id: supportCases.id,
        category: supportCases.category,
        status: supportCases.status,
        description: supportCases.description,
        created_at: supportCases.createdAt,
        updated_at: supportCases.updatedAt,
      })
      .from(supportCases)
      .where(eq(supportCases.orderId, orderId))
      .orderBy(desc(supportCases.createdAt))
    return items
  }

  createCase(
    orderId: string,
    actorId: string,
    canOpenForOthers: boolean,
    input: CreateSupportCaseDto,
  ) {
    return transaction(async (client) => {
      const order = await client.query('SELECT customer_id FROM orders WHERE id=$1', [orderId])
      if (!order.rowCount) return { ok: false, reason: 'not-found' as const }
      if (order.rows[0].customer_id !== actorId && !canOpenForOthers)
        return { ok: false, reason: 'forbidden' as const }
      const result = await client.query(
        'INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,$3,$4) RETURNING id,status,created_at',
        [
          orderId,
          actorId,
          String(input.category ?? 'other').slice(0, 50),
          String(input.description ?? '').trim(),
        ],
      )
      await recordAudit(client, actorId, 'support.opened', 'support_case', result.rows[0].id, {
        orderId,
      })
      return { ok: true, value: result.rows[0] }
    })
  }

  updateCase(caseId: string, actorId: string, assignedTo: string, input: UpdateSupportCaseDto) {
    return transaction(async (client) => {
      const assignee = await client.query(
        "SELECT 1 FROM user_roles WHERE user_id=$1 AND role IN ('admin','cs','finance') LIMIT 1",
        [assignedTo],
      )
      if (!assignee.rowCount) return { ok: false, reason: 'invalid-assignee' as const }
      const result = await client.query(
        'UPDATE support_cases SET status=$2,assigned_to=$3,updated_at=now() WHERE id=$1 RETURNING id,status,updated_at',
        [caseId, input.status, assignedTo],
      )
      if (!result.rowCount) return { ok: false, reason: 'not-found' as const }
      await recordAudit(client, actorId, 'support.updated', 'support_case', caseId, {
        status: input.status,
        assignedTo,
      })
      return { ok: true, value: result.rows[0] }
    })
  }
}
