import * as shared from '../../../shared/api'
import { pool, transaction } from '../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from './route-context'
const { RESERVATION_MINUTES, amount, apiError, body, cents, hasRole, json, money, normalizeItems, pharmacyScope, prescriptionServiceOpen, publicProduct, quoteFingerprint, requireRole, validUuid, verified, serviceFee } = shared

export async function handleCustomerRoutes({ request, url, path, method, requestId, user, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/products' && method === 'GET') {
    const query = (url.searchParams.get('query') ?? '').trim().slice(0, 100)
    const category = url.searchParams.get('category')
    const result = await pool.query(`SELECT p.id,p.sku,p.name,p.description,p.category,p.sell_unit,p.requires_prescription,
      COALESCE(MIN(i.unit_price),0) AS indicative_price,COALESCE(MAX(i.on_hand-i.reserved),0) AS available
      FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.sales_blocked=false
      LEFT JOIN pharmacies ph ON ph.id=i.pharmacy_id AND ph.status='active'
      WHERE p.status='active' AND ($1='' OR p.name ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%' OR p.category ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR p.category=$2) GROUP BY p.id ORDER BY p.category,p.name LIMIT 100`, [query, category || null])
    return json({ items: result.rows.map(publicProduct), categories: [...new Set(result.rows.map((r: any) => r.category))] })
  }
  if (path === '/addresses' && method === 'GET') {
    const result = await pool.query('SELECT id,recipient_name,phone,address_text,city,postal_code,created_at FROM addresses WHERE user_id=$1 ORDER BY created_at DESC', [currentUser.id])
    return json({ items: result.rows.map((r: any) => ({ id:r.id,recipientName:r.recipient_name,phone:r.phone,addressText:r.address_text,city:r.city,postalCode:r.postal_code,createdAt:r.created_at })) })
  }
  if (path === '/addresses' && method === 'POST') {
    const input = await body<any>(request)
    const values = [String(input.recipientName ?? '').trim(), String(input.phone ?? '').trim(), String(input.addressText ?? '').trim(), String(input.city ?? '').trim(), String(input.postalCode ?? '').trim()]
    if (values.some((v) => !v) || values[0].length > 100 || values[2].length > 500) apiError(400, 'INVALID_ADDRESS', 'Lengkapi nama penerima, telepon, alamat, kota, dan kode pos.')
    const result = await pool.query(`INSERT INTO addresses(user_id,recipient_name,phone,address_text,city,postal_code)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,recipient_name,phone,address_text,city,postal_code`, [currentUser.id, ...values])
    const a = result.rows[0]
    return json({ id:a.id,recipientName:a.recipient_name,phone:a.phone,addressText:a.address_text,city:a.city,postalCode:a.postal_code }, 201)
  }
  const addressMatch = path.match(/^\/addresses\/([0-9a-f-]+)$/i)
  if (addressMatch && method === 'PATCH') {
    const input = await body<any>(request)
    const values = [String(input.recipientName ?? '').trim(), String(input.phone ?? '').trim(), String(input.addressText ?? '').trim(), String(input.city ?? '').trim(), String(input.postalCode ?? '').trim()]
    if (values.some((v) => !v)) apiError(400, 'INVALID_ADDRESS', 'Semua kolom alamat diperlukan.')
    const result = await pool.query(`UPDATE addresses SET recipient_name=$3,phone=$4,address_text=$5,city=$6,postal_code=$7,updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING id`, [addressMatch[1], currentUser.id, ...values])
    if (!result.rowCount) apiError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.')
    return json({ id: addressMatch[1] })
  }

  if (path === '/checkout/quote' && method === 'POST') {
    requireRole(currentUser,'customer')
    verified(currentUser)
    const input = await body<any>(request)
    const items = normalizeItems(input.items)
    const methodType = input.fulfillmentMethod === 'pickup' ? 'pickup' : input.fulfillmentMethod === 'delivery' ? 'delivery' : null
    if (!methodType) apiError(400, 'INVALID_FULFILLMENT', 'Pilih pengiriman atau ambil di apotek.')
    if (methodType === 'delivery') apiError(422, 'SHIPPING_PROVIDER_NOT_CONFIGURED', 'Pengiriman belum tersedia sampai penyedia kurir dan tarif wilayah dikonfigurasi. Pilih ambil di apotek.')
    let address: any = null
    if (methodType === 'delivery') {
      if (!validUuid(String(input.addressId ?? ''))) apiError(400, 'ADDRESS_REQUIRED', 'Pilih alamat pengiriman.')
      const addressResult = await pool.query('SELECT * FROM addresses WHERE id=$1 AND user_id=$2', [input.addressId, currentUser.id])
      if (!addressResult.rowCount) apiError(404, 'ADDRESS_NOT_FOUND', 'Alamat tidak ditemukan.')
      address = addressResult.rows[0]
    }
    const productIds = items.map((i) => i.productId)
    const pharmacies = await pool.query("SELECT id,name,address_text,postal_codes,delivery_fee FROM pharmacies WHERE status='active' ORDER BY created_at")
    let chosen: any = null
    for (const pharmacy of pharmacies.rows) {
      if (methodType === 'delivery' && !pharmacy.postal_codes.includes(address.postal_code)) continue
      if (methodType === 'delivery' && pharmacy.delivery_fee == null && process.env.DELIVERY_FEE_DEFAULT == null) continue
      const stock = await pool.query(`SELECT p.id,p.sku,p.name,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,p.status,p.special_handling,
        i.unit_price,i.on_hand-i.reserved AS available,i.sales_blocked
        FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.pharmacy_id=$1 AND p.id=ANY($2::uuid[])`, [pharmacy.id, productIds])
      if (stock.rows.length !== items.length || stock.rows.some((row: any) => row.status !== 'active' || row.special_handling || ['narkotika','psikotropika'].includes(String(row.category).toLowerCase()) || row.sales_blocked || Number(row.available) < (items.find((it) => it.productId === row.id)?.quantity ?? 0))) continue
      if (stock.rows.some((row: any) => row.requires_prescription) && !(await prescriptionServiceOpen(pool, pharmacy.id))) continue
      chosen = { pharmacy, stock: stock.rows }
      break
    }
    if (!chosen) apiError(409, 'PHARMACY_UNAVAILABLE', methodType === 'delivery' ? 'Belum ada apotek dengan stok dan ongkir aktif untuk alamat ini. Coba ambil di apotek atau ubah alamat.' : 'Belum ada satu apotek yang dapat memenuhi seluruh isi keranjang.')
    const itemSnapshots = items.map((item) => {
      const product = chosen.stock.find((row: any) => row.id === item.productId)
      return { productId: product.id, sku: product.sku, name: product.name, sellUnit: product.sell_unit, requiresPrescription: product.requires_prescription, batchTrackingRequired:product.batch_tracking_required,
        quantity: item.quantity, unitPrice: amount(product.unit_price), lineTotal: amount(cents(product.unit_price) * item.quantity / 100) }
    })
    const subtotalCents = itemSnapshots.reduce((sum, item) => sum + cents(item.lineTotal), 0)
    const shipCents = methodType === 'delivery' ? cents(chosen.pharmacy.delivery_fee ?? process.env.DELIVERY_FEE_DEFAULT) : 0
    const totals = { subtotal: money(subtotalCents), discount: '0.00', shippingFee: money(shipCents), serviceFee: amount(serviceFee), total: money(subtotalCents + shipCents + cents(serviceFee)) }
    const addressSnapshot = address ? { recipientName:address.recipient_name,phone:address.phone,addressText:address.address_text,city:address.city,postalCode:address.postal_code } : null
    const fingerprint = quoteFingerprint(chosen.pharmacy.id,methodType,addressSnapshot,itemSnapshots,totals)
    const quote = await pool.query(`INSERT INTO checkout_quotes(customer_id,pharmacy_id,address_id,address_snapshot,fulfillment_method,items_snapshot,totals_snapshot,input_fingerprint,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes') RETURNING id,expires_at`, [currentUser.id, chosen.pharmacy.id, address?.id ?? null, addressSnapshot, methodType, itemSnapshots, totals, fingerprint])
    const needsPrescription = itemSnapshots.some((item) => item.requiresPrescription)
    const hours = needsPrescription ? await pool.query("SELECT weekday,opens_at::text,closes_at::text,timezone FROM pharmacy_service_hours WHERE pharmacy_id=$1 AND service_type='prescription' AND active=true ORDER BY weekday", [chosen.pharmacy.id]) : { rows: [] }
    return json({ quoteId: quote.rows[0].id, expiresAt: quote.rows[0].expires_at, pharmacy: { id: chosen.pharmacy.id, name: chosen.pharmacy.name, address: chosen.pharmacy.address_text },
      fulfillmentMethod:methodType, items:itemSnapshots, totals, needsPrescription,
      prescriptionHours: hours.rows.map((r:any) => ({weekday:r.weekday,opensAt:r.opens_at,closesAt:r.closes_at,timezone:r.timezone})),
      reservationMinutes: RESERVATION_MINUTES, message: 'Harga dan ongkir akan diperiksa sekali lagi saat pesanan dibuat.' })
  }


  return null
}
