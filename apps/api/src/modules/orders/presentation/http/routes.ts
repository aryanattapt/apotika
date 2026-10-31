import { randomBytes } from 'node:crypto'
import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import { recordAudit as audit } from '../../../platform'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { getOrderView, insertOrderStatusHistory } from '../../public'
import { quoteFingerprint } from '../../../checkout'
import { prescriptionServiceOpen } from '../../../pharmacy'
const { RESERVATION_MINUTES, amount, apiError, body, cents, hasRole, hash, json, money, requireRole, serviceFee, validUuid, verified } = shared

export async function handleOrderRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/orders' && method === 'POST') {
    requireRole(currentUser,'customer')
    verified(currentUser)
    const input = await body<any>(request)
    const quoteId = String(input.quoteId ?? '')
    if (!validUuid(quoteId)) apiError(400, 'INVALID_QUOTE', 'Quote tidak valid.')
    const idempotencyKey = request.headers.get('idempotency-key')
    if (!idempotencyKey || idempotencyKey.length > 120) apiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Kunci idempotensi wajib disertakan.')
    const requestHash = hash(JSON.stringify({ quoteId }))
    const output = await transaction(async (client) => {
      const existing = await client.query('SELECT request_hash,response FROM idempotency_keys WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3 FOR UPDATE', [currentUser.id, 'create-order', idempotencyKey])
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash) apiError(409, 'IDEMPOTENCY_CONFLICT', 'Kunci permintaan sudah digunakan dengan isi berbeda.')
        if (existing.rows[0].response) return { ...existing.rows[0].response, replayed: true }
      } else {
        await client.query('INSERT INTO idempotency_keys(actor_id,scope,idempotency_key,request_hash) VALUES($1,$2,$3,$4)', [currentUser.id, 'create-order', idempotencyKey, requestHash])
      }
      const quoteResult = await client.query('SELECT * FROM checkout_quotes WHERE id=$1 AND customer_id=$2 FOR UPDATE', [quoteId, currentUser.id])
      if (!quoteResult.rowCount || new Date(quoteResult.rows[0].expires_at).getTime() <= Date.now()) apiError(409, 'QUOTE_EXPIRED', 'Rincian belanja kedaluwarsa. Perbarui keranjang dan tinjau rincian baru.')
      const quote = quoteResult.rows[0]
      const already = await client.query('SELECT id,status,expires_at,total FROM orders WHERE quote_id=$1', [quoteId])
      if (already.rowCount) return { id: already.rows[0].id, status: already.rows[0].status, expiresAt: already.rows[0].expires_at, total: amount(already.rows[0].total) }
      const itemSnapshots = quote.items_snapshot as any[]
      const ids = itemSnapshots.map((item) => item.productId)
      const locked = await client.query(`SELECT p.id,p.name,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,p.status,p.special_handling,
        i.on_hand,i.reserved,i.unit_price,i.sales_blocked FROM inventory i JOIN products p ON p.id=i.product_id
        WHERE i.pharmacy_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.id FOR UPDATE OF i`, [quote.pharmacy_id, ids])
      if (locked.rows.length !== itemSnapshots.length || locked.rows.some((row: any) => row.status !== 'active' || row.special_handling || ['narkotika','psikotropika'].includes(String(row.category).toLowerCase()) || row.sales_blocked)) apiError(409, 'STOCK_UNAVAILABLE', 'Sebagian produk tidak tersedia. Perbarui keranjang.')
      const updatedItems = itemSnapshots.map((snapshot) => {
        const row = locked.rows.find((entry: any) => entry.id === snapshot.productId)
        const quantity = Number(snapshot.quantity)
        if (!row || Number(row.on_hand) - Number(row.reserved) < quantity) apiError(409, 'STOCK_UNAVAILABLE', 'Stok berubah dan tidak cukup. Perbarui keranjang.')
        return { ...snapshot, name: row.name, sellUnit: row.sell_unit, requiresPrescription: row.requires_prescription, batchTrackingRequired:row.batch_tracking_required, unitPrice: amount(row.unit_price), lineTotal: money(cents(row.unit_price) * quantity) }
      })
      let currentAddress: any = null
      if (quote.fulfillment_method === 'delivery') {
        const addressResult = await client.query('SELECT * FROM addresses WHERE id=$1 AND user_id=$2', [quote.address_id, currentUser.id])
        if (!addressResult.rowCount) apiError(409, 'QUOTE_CHANGED', 'Alamat berubah atau dihapus. Buat quote baru sebelum memesan.')
        const a = addressResult.rows[0]
        currentAddress = { recipientName:a.recipient_name,phone:a.phone,addressText:a.address_text,city:a.city,postalCode:a.postal_code }
      }
      const pharmacyResult = await client.query('SELECT name,address_text,postal_codes,delivery_fee FROM pharmacies WHERE id=$1 AND status=\'active\' FOR SHARE', [quote.pharmacy_id])
      if (!pharmacyResult.rowCount) apiError(409,'PHARMACY_UNAVAILABLE','Apotek pilihan tidak lagi menerima pesanan. Buat quote baru.')
      const pharmacy = pharmacyResult.rows[0]
      const shipCents = quote.fulfillment_method === 'delivery' ? cents(pharmacy?.delivery_fee ?? process.env.DELIVERY_FEE_DEFAULT ?? 0) : 0
      const subtotalCents = updatedItems.reduce((sum, item) => sum + cents(item.lineTotal), 0)
      const totals = { subtotal:money(subtotalCents),discount:'0.00',shippingFee:money(shipCents),serviceFee:amount(serviceFee),total:money(subtotalCents+shipCents+cents(serviceFee)) }
      const currentFingerprint = quoteFingerprint(quote.pharmacy_id,quote.fulfillment_method,currentAddress,updatedItems,totals)
      if (currentFingerprint !== quote.input_fingerprint || (quote.fulfillment_method === 'delivery' && !pharmacy.postal_codes.includes(currentAddress.postalCode))) apiError(409, 'QUOTE_CHANGED', 'Harga, alamat, atau biaya berubah. Tinjau quote baru sebelum pesanan dibuat.')
      if (updatedItems.some((i) => i.requiresPrescription) && !(await prescriptionServiceOpen(client, quote.pharmacy_id))) apiError(422, 'PRESCRIPTION_SERVICE_CLOSED', 'Layanan pemeriksaan resep sedang tutup. Coba kembali saat layanan tersedia.')
      const hasPrescription = updatedItems.some((item) => item.requiresPrescription)
      const status = hasPrescription ? 'awaiting_prescription' : 'awaiting_payment'
      const reservationMinutes = RESERVATION_MINUTES
      const inserted = await client.query(`INSERT INTO orders(quote_id,customer_id,pharmacy_id,address_snapshot,fulfillment_method,status,pickup_code,subtotal,discount,shipping_fee,service_fee,total,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,now()+make_interval(mins=>$12::int)) RETURNING id,expires_at`,
        [quoteId,currentUser.id,quote.pharmacy_id,currentAddress,quote.fulfillment_method,status,randomBytes(3).toString('hex').toUpperCase(),totals.subtotal,totals.shippingFee,totals.serviceFee,totals.total,reservationMinutes])
      const order = inserted.rows[0]
      for (const item of updatedItems) {
        const orderItem = await client.query(`INSERT INTO order_items(order_id,product_id,product_name_snapshot,sell_unit_snapshot,batch_tracking_required_snapshot,requires_prescription_snapshot,quantity,unit_price,line_total)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [order.id,item.productId,item.name,item.sellUnit,item.batchTrackingRequired===true,item.requiresPrescription,item.quantity,item.unitPrice,item.lineTotal])
        await client.query('UPDATE inventory SET reserved=reserved+$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2', [quote.pharmacy_id,item.productId,item.quantity])
        await client.query(`INSERT INTO stock_reservations(order_id,order_item_id,pharmacy_id,product_id,quantity,status,expires_at)
          VALUES($1,$2,$3,$4,$5,'active',$6)`, [order.id,orderItem.rows[0].id,quote.pharmacy_id,item.productId,item.quantity,order.expires_at])
      }
      await insertOrderStatusHistory(client,order.id,null,status,currentUser.id,'Pesanan dibuat')
      await audit(client,currentUser.id,'order.created','order',order.id,{ fulfillmentMethod:quote.fulfillment_method })
      await client.query("INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES('order.created',$1,$2)", [order.id,{ orderId:order.id,status }])
      const response = { id:order.id,status,expiresAt:order.expires_at,totals }
      await client.query('UPDATE idempotency_keys SET response=$4 WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3', [currentUser.id,'create-order',idempotencyKey,response])
      return response
    })
    return json(output, 201)
  }

  if (path === '/orders' && method === 'GET') {
    let result: any
    if (currentUser.roles.some((r) => r.role === 'pharmacist' || r.role === 'pharmacy_staff')) {
      const pharmacyIds = currentUser.roles.filter((r) => r.pharmacyId && ['pharmacist','pharmacy_staff'].includes(r.role)).map((r) => r.pharmacyId)
      result = await pool.query(`SELECT id,status,fulfillment_method,total,created_at,expires_at,pharmacy_id FROM orders
        WHERE customer_id=$1 OR pharmacy_id=ANY($2::uuid[]) ORDER BY created_at DESC LIMIT 100`, [currentUser.id, pharmacyIds])
    } else if (hasRole(currentUser,'admin','cs')) {
      result = await pool.query('SELECT id,status,fulfillment_method,total,created_at,expires_at,pharmacy_id FROM orders ORDER BY created_at DESC LIMIT 100')
    } else {
      result = await pool.query('SELECT id,status,fulfillment_method,total,created_at,expires_at,pharmacy_id FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 100', [currentUser.id])
    }
    return json({ items: result.rows.map((r:any) => ({ id:r.id,status:r.status,fulfillmentMethod:r.fulfillment_method,total:amount(r.total),createdAt:r.created_at,expiresAt:r.expires_at,pharmacyId:r.pharmacy_id })) })
  }
  const orderGet = path.match(/^\/orders\/([0-9a-f-]+)$/i)
  if (orderGet && method === 'GET') {
    const result = await getOrderView(pool, orderGet[1], currentUser)
    if (!result.ok && result.reason === 'not-found') apiError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
    if (!result.ok) apiError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
    return json(result.order)
  }


  return null
}
