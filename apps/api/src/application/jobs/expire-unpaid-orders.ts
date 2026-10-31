import { pool, transaction } from '../../infrastructure/database/client'

export async function expireUnpaidOrders() {
  await transaction(async (client) => {
    const candidates = await client.query(`SELECT id,status FROM orders WHERE status IN ('awaiting_prescription','awaiting_payment') AND expires_at<=now()
      ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED`)
    for (const order of candidates.rows) {
      const changed = await client.query("UPDATE orders SET status='expired',updated_at=now() WHERE id=$1 AND status IN ('awaiting_prescription','awaiting_payment') RETURNING id,status", [order.id])
      if (!changed.rowCount) continue
      const reservations = await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE", [order.id])
      for (const reservation of reservations.rows) {
        await client.query("UPDATE stock_reservations SET status='expired' WHERE id=$1", [reservation.id])
        await client.query('UPDATE inventory SET reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2', [reservation.pharmacy_id, reservation.product_id, reservation.quantity])
      }
      await client.query('INSERT INTO order_status_history(order_id,from_status,to_status,actor_id,reason) VALUES($1,$2,$3,$4,$5)', [order.id, order.status, 'expired', null, 'Masa reservasi berakhir'])
      await client.query("INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES('order.expired',$1,$2)", [order.id, { orderId: order.id }])
    }
  })
}
