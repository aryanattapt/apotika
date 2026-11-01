import { canAccessPharmacy, hasRole, type User } from '../../../shared/domain/access'
import { eq } from 'drizzle-orm'
import { db, transaction } from '../../../infrastructure/database/client'
import { orders } from '../../../infrastructure/database/schema'
import { recordAudit } from '../../platform'
import { canTransitionOrder, insertOrderStatusHistory } from '../../orders'
import { parseDispensedLots } from '../domain/dispensed-lots'
import type {
  FulfillmentCheckRequestDto,
  FulfillmentCommandRequestDto,
  FulfillmentItemRequestDto,
} from '../application/fulfillment.dto'
import {
  FulfillmentOperationError,
  type FulfillmentRepository,
} from '../application/fulfillment.service'

function fail(status: number, code: string, message: string): never {
  throw new FulfillmentOperationError(status, code, message)
}

function checkPharmacyScope(actor: User, pharmacyId: string) {
  if (!canAccessPharmacy(actor, pharmacyId))
    fail(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
}

export class PostgresFulfillmentRepository implements FulfillmentRepository {
  async executeCommand(orderId: string, actor: User, input: FulfillmentCommandRequestDto) {
    return transaction(async (client) => {
      const selected = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])
      if (!selected.rowCount) fail(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
      const order = selected.rows[0]
      checkPharmacyScope(actor, order.pharmacy_id)
      if (input.command === 'start_processing') {
        if (!canTransitionOrder(order.status, 'processing'))
          fail(409, 'INVALID_ORDER_STATE', 'Pesanan harus sudah dibayar sebelum diproses.')
        const paid = await client.query(
          "SELECT 1 FROM payments WHERE order_id=$1 AND status='succeeded' AND received_amount=amount",
          [order.id],
        )
        if (!paid.rowCount)
          fail(409, 'PAYMENT_NOT_CONFIRMED', 'Pembayaran belum terkonfirmasi penuh oleh penyedia.')
        await client.query("UPDATE orders SET status='processing',updated_at=now() WHERE id=$1", [
          order.id,
        ])
        await insertOrderStatusHistory(client, order.id, 'paid', 'processing', actor.id)
      } else if (input.command === 'mark_ready') {
        if (!canTransitionOrder(order.status, 'ready'))
          fail(409, 'INVALID_ORDER_STATE', 'Pesanan harus sedang diproses.')
        const checks = await client.query(
          'SELECT id,passed,pharmacist_check FROM fulfillment_checks WHERE order_id=$1 ORDER BY checked_at DESC LIMIT 1',
          [order.id],
        )
        if (!checks.rowCount || !checks.rows[0].passed)
          fail(
            422,
            'FULFILLMENT_CHECK_REQUIRED',
            'Pemeriksaan kesesuaian produk harus lulus sebelum pesanan siap.',
          )
        const hasRx = await client.query(
          'SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true LIMIT 1',
          [order.id],
        )
        if (hasRx.rowCount && !checks.rows[0].pharmacist_check)
          fail(
            403,
            'PHARMACIST_CHECK_REQUIRED',
            'Pemeriksaan akhir pesanan resep harus dicatat apoteker.',
          )
        const consumed = await client.query(
          "SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' ORDER BY product_id FOR UPDATE",
          [order.id],
        )
        for (const reservation of consumed.rows) {
          const update = await client.query(
            'UPDATE inventory SET on_hand=on_hand-$3,reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2 AND on_hand >= $3 AND reserved >= $3',
            [reservation.pharmacy_id, reservation.product_id, reservation.quantity],
          )
          if (!update.rowCount)
            fail(
              409,
              'INVENTORY_MISMATCH',
              'Alokasi daring tidak cocok. Pemenuhan dihentikan untuk rekonsiliasi.',
            )
          await client.query("UPDATE stock_reservations SET status='consumed' WHERE id=$1", [
            reservation.id,
          ])
          await client.query(
            "INSERT INTO inventory_movements(pharmacy_id,product_id,order_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,'fulfillment',$5)",
            [
              reservation.pharmacy_id,
              reservation.product_id,
              order.id,
              -Number(reservation.quantity),
              actor.id,
            ],
          )
        }
        await client.query("UPDATE orders SET status='ready',updated_at=now() WHERE id=$1", [
          order.id,
        ])
        await insertOrderStatusHistory(client, order.id, 'processing', 'ready', actor.id)
      } else if (input.command === 'confirm_pickup') {
        if (order.fulfillment_method !== 'pickup' || !canTransitionOrder(order.status, 'completed'))
          fail(
            409,
            'INVALID_ORDER_STATE',
            'Hanya pesanan ambil di apotek yang siap dapat diselesaikan.',
          )
        const proofReference = String(input.proofReference ?? '').trim()
        if (
          !input.pickupCode ||
          String(input.pickupCode).toUpperCase() !== order.pickup_code ||
          !proofReference ||
          proofReference.length > 200
        )
          fail(422, 'PICKUP_PROOF_REQUIRED', 'Kode pengambilan dan referensi bukti wajib cocok.')
        await client.query("UPDATE orders SET status='completed',updated_at=now() WHERE id=$1", [
          order.id,
        ])
        await client.query(
          "INSERT INTO shipments(order_id,method,status,handover_reference) VALUES($1,'pickup','completed',$2) ON CONFLICT(order_id) DO UPDATE SET status='completed',handover_reference=EXCLUDED.handover_reference",
          [order.id, proofReference],
        )
        await insertOrderStatusHistory(client, order.id, 'ready', 'completed', actor.id, 'pickup')
        input.proofReference = proofReference
      } else if (input.command === 'handover_to_courier') {
        fail(503, 'SHIPPING_PROVIDER_NOT_CONFIGURED', 'Penyedia pengiriman belum dikonfigurasi.')
      } else fail(400, 'INVALID_COMMAND', 'Perintah pemenuhan tidak dikenal.')
      await recordAudit(
        client,
        actor.id,
        `fulfillment.${input.command}`,
        'order',
        order.id,
        input.command === 'confirm_pickup' ? { proofReference: input.proofReference } : {},
      )
      return {
        orderId: order.id,
        status:
          input.command === 'start_processing'
            ? 'processing'
            : input.command === 'mark_ready'
              ? 'ready'
              : 'completed',
      }
    })
  }

  async createCheck(orderId: string, actor: User, input: FulfillmentCheckRequestDto) {
    return transaction(async (client) => {
      const order = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])
      if (!order.rowCount) fail(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
      checkPharmacyScope(actor, order.rows[0].pharmacy_id)
      if (!canTransitionOrder(order.rows[0].status, 'ready'))
        fail(409, 'INVALID_ORDER_STATE', 'Pemeriksaan hanya tersedia saat penyiapan.')
      const items = await client.query('SELECT id,quantity FROM order_items WHERE order_id=$1', [
        orderId,
      ])
      const supplied = Array.isArray(input.items)
        ? (input.items as FulfillmentItemRequestDto[])
        : []
      if (
        supplied.length !== items.rows.length ||
        items.rows.some(
          (item: { id: string; quantity: number }) =>
            !supplied.some(
              (entry) =>
                entry.orderItemId === item.id && Number(entry.quantity) === Number(item.quantity),
            ),
        )
      )
        fail(422, 'ITEM_CHECK_INCOMPLETE', 'Periksa semua item dan jumlah yang dipesan.')
      const hasRx = await client.query(
        'SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true',
        [orderId],
      )
      const pharmacistCheck = hasRole(actor, 'pharmacist') && input.pharmacistCheck === true
      const passed = input.passed === true
      const checkNote = String(input.note ?? '')
        .trim()
        .slice(0, 1000)
      if (!passed && checkNote.length < 3)
        fail(
          422,
          'FULFILLMENT_NOTE_REQUIRED',
          'Jelaskan kendala pemeriksaan sebelum mengeskalasikannya.',
        )
      if (hasRx.rowCount && !pharmacistCheck && passed)
        fail(
          403,
          'PHARMACIST_CHECK_REQUIRED',
          'Pemeriksaan akhir untuk pesanan resep hanya dapat dicatat apoteker.',
        )
      const batchItems = await client.query(
        'SELECT id,quantity,batch_tracking_required_snapshot FROM order_items WHERE order_id=$1',
        [orderId],
      )
      const lotPlans: Array<{
        orderItemId: string
        lotNumber: string
        expiresOn: string
        quantity: number
      }> = []
      if (passed) {
        for (const orderItem of batchItems.rows) {
          if (!orderItem.batch_tracking_required_snapshot) continue
          const entry = supplied.find((item) => item.orderItemId === orderItem.id)
          const parsedLots = parseDispensedLots(entry?.lots, Number(orderItem.quantity))
          if (!parsedLots.ok) {
            if (parsedLots.reason === 'required')
              fail(
                422,
                'LOT_REQUIRED',
                'Catat nomor batch dan tanggal kedaluwarsa untuk setiap produk yang memerlukan pelacakan.',
              )
            if (parsedLots.reason === 'quantity-mismatch')
              fail(
                422,
                'LOT_QUANTITY_MISMATCH',
                'Jumlah unit pada catatan batch harus sama dengan jumlah pesanan.',
              )
            fail(
              422,
              'LOT_INVALID',
              'Nomor batch, tanggal kedaluwarsa, dan jumlah unit harus diisi dengan benar.',
            )
          }
          for (const lot of parsedLots.lots) {
            const expiry = await client.query('SELECT $1::date>=CURRENT_DATE AS valid', [
              lot.expiresOn,
            ])
            if (!expiry.rows[0].valid)
              fail(422, 'LOT_EXPIRED', 'Tanggal kedaluwarsa produk sudah lewat.')
            lotPlans.push({ orderItemId: orderItem.id, ...lot })
          }
        }
      }
      const inserted = await client.query(
        `INSERT INTO fulfillment_checks(order_id,actor_id,pharmacist_check,passed,note)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [orderId, actor.id, pharmacistCheck, passed, checkNote || null],
      )
      for (const lot of lotPlans)
        await client.query(
          'INSERT INTO dispensed_lots(fulfillment_check_id,order_item_id,lot_number,expires_on,quantity) VALUES($1,$2,$3,$4,$5)',
          [inserted.rows[0].id, lot.orderItemId, lot.lotNumber, lot.expiresOn, lot.quantity],
        )
      if (!passed) {
        const activeCase = await client.query(
          "SELECT id FROM support_cases WHERE order_id=$1 AND category='fulfillment' AND status<>'closed' LIMIT 1",
          [orderId],
        )
        if (!activeCase.rowCount) {
          const opened = await client.query(
            "INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,'fulfillment',$3) RETURNING id",
            [orderId, actor.id, `Pemeriksaan pemenuhan gagal: ${checkNote}`],
          )
          await recordAudit(client, actor.id, 'support.opened', 'support_case', opened.rows[0].id, {
            category: 'fulfillment',
          })
        }
      }
      await recordAudit(client, actor.id, 'fulfillment.checked', 'order', orderId, {
        passed,
        pharmacistCheck,
      })
      return { id: inserted.rows[0].id, passed, pharmacistCheck, escalated: !passed }
    })
  }

  async createShipmentBooking(orderId: string, actor: User): Promise<never> {
    const [order] = await db
      .select({
        pharmacy_id: orders.pharmacyId,
        fulfillment_method: orders.fulfillmentMethod,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
    if (!order) fail(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
    checkPharmacyScope(actor, order.pharmacy_id)
    if (order.fulfillment_method !== 'delivery' || order.status !== 'ready')
      fail(
        409,
        'INVALID_ORDER_STATE',
        'Hanya pesanan pengiriman yang siap dapat dibuatkan booking.',
      )
    fail(503, 'SHIPPING_PROVIDER_NOT_CONFIGURED', 'Penyedia pengiriman belum dikonfigurasi.')
  }
}
