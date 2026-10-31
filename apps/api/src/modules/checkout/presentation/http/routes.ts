import * as shared from '../../../../shared/api'
import { pool } from '../../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { serviceFee, RESERVATION_MINUTES } from '../../../../shared/config'
import { buildQuoteSnapshot } from '../../application/build-quote'
import { parseCartItems } from '../../domain/cart'
import { prescriptionServiceOpen } from '../../../pharmacy'

const { apiError, body, json, requireRole, validUuid, verified } = shared

export async function handleCheckoutRoutes({ request, path, method, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if (path !== '/checkout/quote' || method !== 'POST') return null

  requireRole(currentUser, 'customer')
  verified(currentUser)
  const input = await body<any>(request)
  const parsedItems = parseCartItems(input.items)
  if (!parsedItems.ok) {
    const message = parsedItems.reason === 'INVALID_LENGTH'
      ? 'Keranjang harus berisi 1 sampai 30 produk.'
      : parsedItems.reason === 'DUPLICATE_PRODUCT'
        ? 'Produk yang sama tidak boleh muncul lebih dari satu kali.'
        : 'Produk atau jumlah pada keranjang tidak valid.'
    apiError(400, 'INVALID_ITEMS', message)
  }
  const items = parsedItems.items
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

  const productIds = items.map((item) => item.productId)
  const pharmacies = await pool.query("SELECT id,name,address_text,postal_codes,delivery_fee FROM pharmacies WHERE status='active' ORDER BY created_at")
  let chosen: any = null
  for (const pharmacy of pharmacies.rows) {
    if (methodType === 'delivery' && !pharmacy.postal_codes.includes(address.postal_code)) continue
    if (methodType === 'delivery' && pharmacy.delivery_fee == null && process.env.DELIVERY_FEE_DEFAULT == null) continue
    const stock = await pool.query(`SELECT p.id,p.sku,p.name,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,p.status,p.special_handling,
      i.unit_price,i.on_hand-i.reserved AS available,i.sales_blocked
      FROM inventory i JOIN products p ON p.id=i.product_id WHERE i.pharmacy_id=$1 AND p.id=ANY($2::uuid[])`, [pharmacy.id, productIds])
    if (stock.rows.length !== items.length || stock.rows.some((row: any) => row.status !== 'active' || row.special_handling || ['narkotika','psikotropika'].includes(String(row.category).toLowerCase()) || row.sales_blocked || Number(row.available) < (items.find((item) => item.productId === row.id)?.quantity ?? 0))) continue
    if (stock.rows.some((row: any) => row.requires_prescription) && !(await prescriptionServiceOpen(pool, pharmacy.id))) continue
    chosen = { pharmacy, stock: stock.rows }
    break
  }
  if (!chosen) apiError(409, 'PHARMACY_UNAVAILABLE', methodType === 'delivery' ? 'Belum ada apotek dengan stok dan ongkir aktif untuk alamat ini. Coba ambil di apotek atau ubah alamat.' : 'Belum ada satu apotek yang dapat memenuhi seluruh isi keranjang.')

  const addressSnapshot = address ? { recipientName:address.recipient_name,phone:address.phone,addressText:address.address_text,city:address.city,postalCode:address.postal_code } : null
  const quoteSnapshot = buildQuoteSnapshot({
    pharmacyId: chosen.pharmacy.id,
    fulfillmentMethod: methodType,
    address: addressSnapshot,
    cart: items,
    stock: chosen.stock,
    shippingFee: chosen.pharmacy.delivery_fee ?? process.env.DELIVERY_FEE_DEFAULT,
    serviceFee,
  })
  if (!quoteSnapshot) apiError(409, 'PHARMACY_UNAVAILABLE', 'Stok apotek berubah. Perbarui keranjang dan coba lagi.')
  const quote = await pool.query(`INSERT INTO checkout_quotes(customer_id,pharmacy_id,address_id,address_snapshot,fulfillment_method,items_snapshot,totals_snapshot,input_fingerprint,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes') RETURNING id,expires_at`, [currentUser.id, chosen.pharmacy.id, address?.id ?? null, addressSnapshot, methodType, quoteSnapshot.items, quoteSnapshot.totals, quoteSnapshot.fingerprint])
  const hours = quoteSnapshot.needsPrescription
    ? await pool.query("SELECT weekday,opens_at::text,closes_at::text,timezone FROM pharmacy_service_hours WHERE pharmacy_id=$1 AND service_type='prescription' AND active=true ORDER BY weekday", [chosen.pharmacy.id])
    : { rows: [] }
  return json({
    quoteId: quote.rows[0].id,
    expiresAt: quote.rows[0].expires_at,
    pharmacy: { id: chosen.pharmacy.id, name: chosen.pharmacy.name, address: chosen.pharmacy.address_text },
    fulfillmentMethod: methodType,
    items: quoteSnapshot.items,
    totals: quoteSnapshot.totals,
    needsPrescription: quoteSnapshot.needsPrescription,
    prescriptionHours: hours.rows.map((row: any) => ({ weekday:row.weekday, opensAt:row.opens_at, closesAt:row.closes_at, timezone:row.timezone })),
    reservationMinutes: RESERVATION_MINUTES,
    message: 'Harga dan ongkir akan diperiksa sekali lagi saat pesanan dibuat.',
  })
}
