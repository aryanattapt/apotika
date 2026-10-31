import { createHash, randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import { pool, transaction } from '../infrastructure/database/client'

export const API = '/api/v1'
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
export const SESSION_SECONDS = 60 * 60 * 24 * 7
export const RESERVATION_MINUTES = Math.max(5, Number(process.env.RESERVATION_MINUTES ?? 30))
export const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 8 * 1024 * 1024)
if (!Number.isSafeInteger(UPLOAD_MAX_BYTES) || UPLOAD_MAX_BYTES < 1) throw new Error('UPLOAD_MAX_BYTES harus berupa bilangan bulat positif.')
export const MAX_REQUEST_BODY_BYTES = UPLOAD_MAX_BYTES + 256 * 1024
export const secureCookie = process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'
export const serviceFee = Number(process.env.SERVICE_FEE ?? 0)
export const rateBuckets = new Map<string, { count: number; resetAt: number }>()
export let lastRateBucketCleanup = Date.now()
let requestIpResolver: (request: Request) => string | undefined = () => undefined

export function configureRequestIpResolver(resolve: (request: Request) => string | undefined) { requestIpResolver = resolve }

export type Role = { role: string; pharmacyId: string | null }
export type User = { id: string; name: string; email: string | null; phone: string | null; email_verified_at: string | null; phone_verified_at: string | null; roles: Role[]; csrfToken: string }
export type Context = { user: User; requestId: string }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex') }
export function quoteFingerprint(pharmacyId:string,methodType:string,addressSnapshot:any,items:any[],totals:any){
  const canonicalItems=items.map((item)=>[item.productId,item.sku,item.name,item.sellUnit,item.requiresPrescription,item.batchTrackingRequired,Number(item.quantity),amount(item.unitPrice),amount(item.lineTotal)])
  const canonicalTotals=[amount(totals.subtotal),amount(totals.discount),amount(totals.shippingFee),amount(totals.serviceFee),amount(totals.total)]
  const canonicalAddress=addressSnapshot?[addressSnapshot.recipientName,addressSnapshot.phone,addressSnapshot.addressText,addressSnapshot.city,addressSnapshot.postalCode]:null
  return hash(JSON.stringify([pharmacyId,methodType,canonicalAddress,canonicalItems,canonicalTotals]))
}
export function apiError(status: number, code: string, message: string): never { throw new ApiError(status, code, message) }
export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ data }), { status, headers: responseHeaders })
}
export function errorJson(error: ApiError, requestId: string) {
  return new Response(JSON.stringify({ error: { code: error.code, message: error.message, requestId } }), {
    status: error.status, headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
export async function body<T>(request: Request): Promise<T> {
  try { return await request.json() as T } catch { return apiError(400, 'INVALID_JSON', 'Isi permintaan tidak valid.') }
}
export function cookieValue(request: Request, name: string) {
  const entry = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null
}
export function sessionCookie(token: string) {
  return `apotek_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`
}
export function expiredCookie() { return `apotek_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}` }
export function limit(request: Request, scope: string, max = 30) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : null
  const ip = forwarded || requestIpResolver(request) || 'local'
  const key = `${scope}:${ip}`
  const now = Date.now()
  if (now - lastRateBucketCleanup >= 60_000) {
    for (const [entry, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(entry)
    lastRateBucketCleanup = now
  }
  const current = rateBuckets.get(key)
  if (!current || current.resetAt < now) rateBuckets.set(key, { count: 1, resetAt: now + 60_000 })
  else if (++current.count > max) apiError(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar.')
}
export async function userForRequest(request: Request): Promise<User | null> {
  const token = cookieValue(request, 'apotek_session')
  if (!token) return null
  const result = await pool.query(`
    SELECT s.id AS session_id, s.csrf_token, u.id, u.name, u.email, u.phone, u.email_verified_at, u.phone_verified_at
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.session_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='active'
  `, [hash(token)])
  if (!result.rowCount) return null
  const row = result.rows[0]
  const roleRows = await pool.query('SELECT role, pharmacy_id FROM user_roles WHERE user_id=$1', [row.id])
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    email_verified_at: row.email_verified_at, phone_verified_at: row.phone_verified_at,
    roles: roleRows.rows.map((r) => ({ role: r.role, pharmacyId: r.pharmacy_id })), csrfToken: row.csrf_token,
  }
}
export function requireUser(user: User | null): User {
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Silakan masuk untuk melanjutkan.')
  return user
}
export function hasRole(user: User, ...roles: string[]) { return user.roles.some((entry) => roles.includes(entry.role)) }
export function requireRole(user: User, ...roles: string[]) {
  if (!hasRole(user, ...roles)) apiError(403, 'FORBIDDEN', 'Akses tidak diizinkan untuk akun ini.')
}
export function pharmacyScope(user: User, pharmacyId: string) {
  if (!user.roles.some((entry) => ['admin', 'pharmacist', 'pharmacy_staff'].includes(entry.role) && (entry.role === 'admin' || entry.pharmacyId === pharmacyId))) {
    apiError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
  }
}
export function verified(user: User) {
  if (!(user.email && user.email_verified_at) && !(user.phone && user.phone_verified_at)) {
    apiError(422, 'CONTACT_NOT_VERIFIED', 'Verifikasi email atau nomor telepon sebelum bertransaksi.')
  }
}
export function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
export function amount(value: string | number) { return Number(value).toFixed(2) }
export function cents(value: string | number) { return Math.round(Number(value) * 100) }
export function money(value: number) { return (value / 100).toFixed(2) }
export function csvSafeName(name: string) { return basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'dokumen' }
export function userJson(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    contactVerified: Boolean((user.email && user.email_verified_at) || (user.phone && user.phone_verified_at)),
    roles: user.roles, csrfToken: user.csrfToken,
  }
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  await pool.query(`INSERT INTO auth_sessions(user_id, session_token_hash, csrf_token, expires_at)
    VALUES ($1,$2,$3,now()+make_interval(secs=>$4::int))`, [userId, hash(token), csrf, SESSION_SECONDS])
  return { token, csrf }
}
export async function issueToken(userId: string, type: string, target: string | null, client: any = pool) {
  const token = randomBytes(32).toString('base64url')
  await client.query(`INSERT INTO auth_tokens(user_id,type,target_contact,token_hash,expires_at)
    VALUES ($1,$2,$3,$4,now()+interval '30 minutes')`, [userId, type, target, hash(token)])
  const parameter = type === 'password_reset' ? 'reset' : 'verify'
  return process.env.NODE_ENV === 'production' ? null : `${WEB_ORIGIN}/?${parameter}=${encodeURIComponent(token)}`
}
export async function audit(client: any, actorId: string | null, action: string, type: string, id: string | null, metadata: Record<string, unknown> = {}) {
  await client.query('INSERT INTO audit_log(actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)', [actorId, action, type, id, metadata])
}
export async function addHistory(client: any, orderId: string, from: string | null, to: string, actorId: string | null, reason: string | null = null) {
  await client.query('INSERT INTO order_status_history(order_id,from_status,to_status,actor_id,reason) VALUES($1,$2,$3,$4,$5)', [orderId, from, to, actorId, reason])
}
export function normalizeItems(input: unknown) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) apiError(400, 'INVALID_ITEMS', 'Keranjang harus berisi 1 sampai 30 produk.')
  const byId = new Map<string, number>()
  for (const row of input as any[]) {
    if (!row || !validUuid(String(row.productId)) || !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 1 || Number(row.quantity) > 20) {
      apiError(400, 'INVALID_ITEMS', 'Produk atau jumlah pada keranjang tidak valid.')
    }
    const id = String(row.productId)
    if (byId.has(id)) apiError(400, 'INVALID_ITEMS', 'Produk yang sama tidak boleh muncul lebih dari satu kali.')
    byId.set(id, Number(row.quantity))
  }
  return [...byId].map(([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId))
}
export function localServiceTime(timeZone: string) {
  try {
    const pieces = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year:'numeric',month:'2-digit',day:'2-digit',hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const values = Object.fromEntries(pieces.map((part) => [part.type, part.value]))
    const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { weekday: days[values.weekday], minute: Number(values.hour) * 60 + Number(values.minute), date:`${values.year}-${values.month}-${values.day}` }
  } catch {
    return null
  }
}
export function validClock(value: unknown): value is string { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) }
export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
}
export function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
export async function prescriptionServiceOpen(client: any, pharmacyId: string) {
  const rows = await client.query(`SELECT weekday, opens_at::text, closes_at::text, timezone FROM pharmacy_service_hours
    WHERE pharmacy_id=$1 AND service_type='prescription' AND active=true`, [pharmacyId])
  for (const row of rows.rows) {
    const local = localServiceTime(row.timezone)
    if (!local) continue
    const exception = await client.query(`SELECT closed,opens_at::text,closes_at::text FROM pharmacy_service_exceptions
      WHERE pharmacy_id=$1 AND service_type='prescription' AND local_date=$2`,[pharmacyId,local.date])
    const special=exception.rows[0]
    if(special?.closed)continue
    const opens=special?.opens_at??row.opens_at
    const closes=special?.closes_at??row.closes_at
    const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
    if(Number(row.weekday)===local.weekday&&local.minute>=toMinutes(opens)&&local.minute<toMinutes(closes))return true
  }
  return false
}
export function publicProduct(row: any) {
  return { id: row.id, sku: row.sku, name: row.name, description: row.description, category: row.category,
    sellUnit: row.sell_unit, requiresPrescription: row.requires_prescription, batchTrackingRequired: row.batch_tracking_required===true, indicativePrice: amount(row.indicative_price),
    available: Number(row.available ?? 0) > 0, stock: Math.max(0, Number(row.available ?? 0)) }
}
export async function getOrder(client: any, orderId: string, user: User, lock = false) {
  const base = await client.query(`SELECT o.*, ph.name AS pharmacy_name, ph.address_text AS pharmacy_address, p.name AS customer_name
    FROM orders o JOIN pharmacies ph ON ph.id=o.pharmacy_id JOIN users p ON p.id=o.customer_id
    WHERE o.id=$1 ${lock ? 'FOR UPDATE OF o' : ''}`, [orderId])
  if (!base.rowCount) apiError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  const order = base.rows[0]
  if (order.customer_id !== user.id) pharmacyScope(user, order.pharmacy_id)
  const [items, prescriptions, history, payment, fulfillmentCheck] = await Promise.all([
    client.query('SELECT id,product_id,product_name_snapshot,sell_unit_snapshot,batch_tracking_required_snapshot,requires_prescription_snapshot,quantity,unit_price,line_total FROM order_items WHERE order_id=$1 ORDER BY product_name_snapshot', [orderId]),
    client.query('SELECT id,status,document_revision,created_at FROM prescriptions WHERE order_id=$1 ORDER BY created_at DESC', [orderId]),
    client.query('SELECT from_status,to_status,reason,created_at FROM order_status_history WHERE order_id=$1 ORDER BY created_at', [orderId]),
    client.query('SELECT id,status,amount,received_amount,currency,expires_at FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1', [orderId]),
    client.query('SELECT passed,pharmacist_check,note,checked_at FROM fulfillment_checks WHERE order_id=$1 ORDER BY checked_at DESC LIMIT 1',[orderId]),
  ])
  return { id: order.id, customerId: order.customer_id, pharmacyId: order.pharmacy_id, pharmacyName: order.pharmacy_name, reviewVersion: Number(order.review_version),
    pharmacyAddress: order.pharmacy_address, status: order.status, fulfillmentMethod: order.fulfillment_method,
    items: items.rows.map((i: any) => ({ id: i.id, productId: i.product_id, name: i.product_name_snapshot, sellUnit: i.sell_unit_snapshot,
      requiresPrescription: i.requires_prescription_snapshot, batchTrackingRequired:i.batch_tracking_required_snapshot, quantity: i.quantity, unitPrice: amount(i.unit_price), lineTotal: amount(i.line_total) })),
    totals: { subtotal: amount(order.subtotal), discount: amount(order.discount), shippingFee: amount(order.shipping_fee), serviceFee: amount(order.service_fee), total: amount(order.total) },
    expiresAt: order.expires_at, createdAt: order.created_at, prescriptions: prescriptions.rows.map((p: any) => ({ id: p.id, status: p.status, revision: p.document_revision, uploadedAt: p.created_at })),
    payment: payment.rows[0] ? { id: payment.rows[0].id, status: payment.rows[0].status, amount: amount(payment.rows[0].amount), receivedAmount: payment.rows[0].received_amount == null ? null : amount(payment.rows[0].received_amount), currency: payment.rows[0].currency, expiresAt: payment.rows[0].expires_at } : null,
    fulfillmentCheck:fulfillmentCheck.rows[0]?{passed:fulfillmentCheck.rows[0].passed,pharmacistCheck:fulfillmentCheck.rows[0].pharmacist_check,note:fulfillmentCheck.rows[0].note,checkedAt:fulfillmentCheck.rows[0].checked_at}:null,
    pickupCode: order.customer_id === user.id && order.fulfillment_method === 'pickup' ? order.pickup_code : undefined,
    history: history.rows.map((h: any) => ({ from: h.from_status, to: h.to_status, reason: h.reason, at: h.created_at })),
  }
}

