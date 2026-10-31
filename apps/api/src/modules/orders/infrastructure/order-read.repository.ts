import type { OrderReadModel } from '../application/get-order'

export type Queryable = { query: (...args: any[]) => Promise<any> }

export class PostgresOrderReadRepository {
  constructor(private readonly client: Queryable) {}

  async findById(orderId: string): Promise<OrderReadModel | null> {
    const base = await this.client.query(`SELECT o.*, ph.name AS pharmacy_name, ph.address_text AS pharmacy_address, p.name AS customer_name
      FROM orders o JOIN pharmacies ph ON ph.id=o.pharmacy_id JOIN users p ON p.id=o.customer_id
      WHERE o.id=$1`, [orderId])
    if (!base.rowCount) return null
    const order = base.rows[0]
    const [items, prescriptions, history, payment, fulfillmentCheck] = await Promise.all([
      this.client.query('SELECT id,product_id,product_name_snapshot,sell_unit_snapshot,batch_tracking_required_snapshot,requires_prescription_snapshot,quantity,unit_price,line_total FROM order_items WHERE order_id=$1 ORDER BY product_name_snapshot', [orderId]),
      this.client.query('SELECT id,status,document_revision,created_at FROM prescriptions WHERE order_id=$1 ORDER BY created_at DESC', [orderId]),
      this.client.query('SELECT from_status,to_status,reason,created_at FROM order_status_history WHERE order_id=$1 ORDER BY created_at', [orderId]),
      this.client.query('SELECT id,status,amount,received_amount,currency,expires_at FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1', [orderId]),
      this.client.query('SELECT passed,pharmacist_check,note,checked_at FROM fulfillment_checks WHERE order_id=$1 ORDER BY checked_at DESC LIMIT 1', [orderId]),
    ])
    return { order, items: items.rows, prescriptions: prescriptions.rows, history: history.rows, payment: payment.rows[0] ?? null, fulfillmentCheck: fulfillmentCheck.rows[0] ?? null }
  }
}
