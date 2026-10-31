import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pool, transaction } from './db'
import { decryptMfaSecret, verifyTotp } from './security'

const PORT = Number(process.env.API_PORT ?? 4000)
const API = '/api/v1'
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
const SESSION_SECONDS = 60 * 60 * 24 * 7
const RESERVATION_MINUTES = Math.max(5, Number(process.env.RESERVATION_MINUTES ?? 30))
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 8 * 1024 * 1024)
if (!Number.isSafeInteger(UPLOAD_MAX_BYTES) || UPLOAD_MAX_BYTES < 1) throw new Error('UPLOAD_MAX_BYTES harus berupa bilangan bulat positif.')
const MAX_REQUEST_BODY_BYTES = UPLOAD_MAX_BYTES + 256 * 1024
const secureCookie = process.env.SESSION_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production'
const serviceFee = Number(process.env.SERVICE_FEE ?? 0)
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
let lastRateBucketCleanup = Date.now()

type Role = { role: string; pharmacyId: string | null }
type User = { id: string; name: string; email: string | null; phone: string | null; email_verified_at: string | null; phone_verified_at: string | null; roles: Role[]; csrfToken: string }
type Context = { user: User; requestId: string }

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

function hash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex') }
function quoteFingerprint(pharmacyId:string,methodType:string,addressSnapshot:any,items:any[],totals:any){
  const canonicalItems=items.map((item)=>[item.productId,item.sku,item.name,item.sellUnit,item.requiresPrescription,item.batchTrackingRequired,Number(item.quantity),amount(item.unitPrice),amount(item.lineTotal)])
  const canonicalTotals=[amount(totals.subtotal),amount(totals.discount),amount(totals.shippingFee),amount(totals.serviceFee),amount(totals.total)]
  const canonicalAddress=addressSnapshot?[addressSnapshot.recipientName,addressSnapshot.phone,addressSnapshot.addressText,addressSnapshot.city,addressSnapshot.postalCode]:null
  return hash(JSON.stringify([pharmacyId,methodType,canonicalAddress,canonicalItems,canonicalTotals]))
}
function apiError(status: number, code: string, message: string): never { throw new ApiError(status, code, message) }
function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ data }), { status, headers: responseHeaders })
}
function errorJson(error: ApiError, requestId: string) {
  return new Response(JSON.stringify({ error: { code: error.code, message: error.message, requestId } }), {
    status: error.status, headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
async function body<T>(request: Request): Promise<T> {
  try { return await request.json() as T } catch { return apiError(400, 'INVALID_JSON', 'Isi permintaan tidak valid.') }
}
function cookieValue(request: Request, name: string) {
  const entry = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null
}
function sessionCookie(token: string) {
  return `apotek_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secureCookie ? '; Secure' : ''}`
}
function expiredCookie() { return `apotek_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}` }
function limit(request: Request, scope: string, max = 30) {
  const forwarded = process.env.TRUST_PROXY === 'true' ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : null
  const ip = forwarded || server.requestIP(request)?.address || 'local'
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
async function userForRequest(request: Request): Promise<User | null> {
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
function requireUser(user: User | null): User {
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Silakan masuk untuk melanjutkan.')
  return user
}
function hasRole(user: User, ...roles: string[]) { return user.roles.some((entry) => roles.includes(entry.role)) }
function requireRole(user: User, ...roles: string[]) {
  if (!hasRole(user, ...roles)) apiError(403, 'FORBIDDEN', 'Akses tidak diizinkan untuk akun ini.')
}
function pharmacyScope(user: User, pharmacyId: string) {
  if (!user.roles.some((entry) => ['admin', 'pharmacist', 'pharmacy_staff'].includes(entry.role) && (entry.role === 'admin' || entry.pharmacyId === pharmacyId))) {
    apiError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
  }
}
function verified(user: User) {
  if (!(user.email && user.email_verified_at) && !(user.phone && user.phone_verified_at)) {
    apiError(422, 'CONTACT_NOT_VERIFIED', 'Verifikasi email atau nomor telepon sebelum bertransaksi.')
  }
}
function validUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function amount(value: string | number) { return Number(value).toFixed(2) }
function cents(value: string | number) { return Math.round(Number(value) * 100) }
function money(value: number) { return (value / 100).toFixed(2) }
function csvSafeName(name: string) { return basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'dokumen' }
function userJson(user: User) {
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone,
    contactVerified: Boolean((user.email && user.email_verified_at) || (user.phone && user.phone_verified_at)),
    roles: user.roles, csrfToken: user.csrfToken,
  }
}
async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  await pool.query(`INSERT INTO auth_sessions(user_id, session_token_hash, csrf_token, expires_at)
    VALUES ($1,$2,$3,now()+make_interval(secs=>$4::int))`, [userId, hash(token), csrf, SESSION_SECONDS])
  return { token, csrf }
}
async function issueToken(userId: string, type: string, target: string | null, client: any = pool) {
  const token = randomBytes(32).toString('base64url')
  await client.query(`INSERT INTO auth_tokens(user_id,type,target_contact,token_hash,expires_at)
    VALUES ($1,$2,$3,$4,now()+interval '30 minutes')`, [userId, type, target, hash(token)])
  const parameter = type === 'password_reset' ? 'reset' : 'verify'
  return process.env.NODE_ENV === 'production' ? null : `${WEB_ORIGIN}/?${parameter}=${encodeURIComponent(token)}`
}
async function audit(client: any, actorId: string | null, action: string, type: string, id: string | null, metadata: Record<string, unknown> = {}) {
  await client.query('INSERT INTO audit_log(actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5)', [actorId, action, type, id, metadata])
}
async function addHistory(client: any, orderId: string, from: string | null, to: string, actorId: string | null, reason: string | null = null) {
  await client.query('INSERT INTO order_status_history(order_id,from_status,to_status,actor_id,reason) VALUES($1,$2,$3,$4,$5)', [orderId, from, to, actorId, reason])
}
function normalizeItems(input: unknown) {
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
function localServiceTime(timeZone: string) {
  try {
    const pieces = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year:'numeric',month:'2-digit',day:'2-digit',hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
    const values = Object.fromEntries(pieces.map((part) => [part.type, part.value]))
    const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return { weekday: days[values.weekday], minute: Number(values.hour) * 60 + Number(values.minute), date:`${values.year}-${values.month}-${values.day}` }
  } catch {
    return null
  }
}
function validClock(value: unknown): value is string { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) }
function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true } catch { return false }
}
function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
async function prescriptionServiceOpen(client: any, pharmacyId: string) {
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
function publicProduct(row: any) {
  return { id: row.id, sku: row.sku, name: row.name, description: row.description, category: row.category,
    sellUnit: row.sell_unit, requiresPrescription: row.requires_prescription, batchTrackingRequired: row.batch_tracking_required===true, indicativePrice: amount(row.indicative_price),
    available: Number(row.available ?? 0) > 0, stock: Math.max(0, Number(row.available ?? 0)) }
}
async function getOrder(client: any, orderId: string, user: User, lock = false) {
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

async function route(request: Request, user: User | null, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice(API.length) || '/'
  const method = request.method.toUpperCase()

  if (path === '/health' && method === 'GET') {
    const result = await pool.query('SELECT 1 AS ok')
    return json({ status: 'ok', database: result.rowCount === 1 })
  }

  if (path === '/auth/session' && method === 'GET') return json({ user: user ? userJson(user) : null })

  if (path === '/auth/register' && method === 'POST') {
    limit(request, 'register', 5)
    const input = await body<any>(request)
    const name = String(input.name ?? '').trim()
    const email = input.email ? String(input.email).trim().toLowerCase() : null
    const phone = input.phone ? String(input.phone).trim() : null
    const password = String(input.password ?? '')
    if (name.length < 2 || name.length > 100 || (!email && !phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (phone && !/^\+?[0-9\s()-]{8,20}$/.test(phone))) {
      apiError(400, 'INVALID_PROFILE', 'Nama dan email atau nomor telepon yang valid diperlukan.')
    }
    if (password.length < 12 || password.length > 128) apiError(400, 'WEAK_PASSWORD', 'Kata sandi harus berisi 12–128 karakter.')
    const target = email ?? phone
    const created = await transaction(async (client) => {
      const result = await client.query(`INSERT INTO users(name,email,phone,password_hash) VALUES($1,$2,$3,$4)
        RETURNING id`, [name, email, phone, await Bun.password.hash(password)])
      const id = result.rows[0].id
      await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'customer')", [id])
      const verificationUrl = await issueToken(id, email ? 'verify_email' : 'verify_phone', target, client)
      return { verificationUrl }
    })
    return json({ message: 'Akun dibuat. Verifikasi kontak sebelum transaksi.', verificationUrl: created.verificationUrl }, 201)
  }

  if (path === '/auth/contact-verification' && method === 'POST') {
    limit(request, 'verify', 10)
    const input = await body<any>(request)
    const token = String(input.token ?? '')
    if (!token) apiError(400, 'TOKEN_REQUIRED', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
    await transaction(async (client) => {
      const result = await client.query(`UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND type IN ('verify_email','verify_phone')
        AND used_at IS NULL AND expires_at>now() RETURNING user_id,type,target_contact`, [hash(token)])
      if (!result.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
      const row = result.rows[0]
      const column = row.type === 'verify_email' ? 'email_verified_at' : 'phone_verified_at'
      const contactColumn = row.type === 'verify_email' ? 'email' : 'phone'
      const updated = await client.query(`UPDATE users SET ${column}=now(), updated_at=now() WHERE id=$1 AND ${contactColumn}=$2`, [row.user_id, row.target_contact])
      if (!updated.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
      await client.query("INSERT INTO audit_log(action,resource_type,resource_id,metadata) VALUES('auth.contact_verified','user',$1,$2)",[row.user_id,{contactType:row.type}])
    })
    return json({ message: 'Kontak berhasil diverifikasi. Silakan masuk.' })
  }

  if (path === '/auth/password-reset' && method === 'POST') {
    limit(request, 'password-reset', 5)
    const input = await body<any>(request)
    if (input.token && input.newPassword) {
      const newPassword = String(input.newPassword)
      if (newPassword.length < 12 || newPassword.length > 128) apiError(400, 'WEAK_PASSWORD', 'Kata sandi harus berisi 12–128 karakter.')
      const passwordHash = await Bun.password.hash(newPassword)
      await transaction(async (client) => {
        const token = await client.query(`UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND type='password_reset' AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [hash(String(input.token))])
        if (!token.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan reset tidak valid atau kedaluwarsa.')
        const userId = token.rows[0].user_id
        await client.query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [userId, passwordHash])
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId])
        await client.query("INSERT INTO audit_log(action,resource_type,resource_id,metadata) VALUES($1,'user',$2,'{}')",['auth.password_reset',userId])
      })
      return json({ message: 'Kata sandi berhasil diperbarui. Silakan masuk kembali.' })
    }
    const contact = String(input.contact ?? '').trim().toLowerCase()
    const result = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1', [contact])
    let resetUrl: string | null = null
    if (result.rowCount) resetUrl = await issueToken(result.rows[0].id, 'password_reset', contact)
    return json({ message: 'Jika akun cocok, petunjuk pemulihan akan dikirim.', resetUrl })
  }

  if (path === '/auth/login' && method === 'POST') {
    limit(request, 'login', 12)
    const input = await body<any>(request)
    const password = String(input.password ?? '')
    if (password.length < 1 || password.length > 128) apiError(401, 'INVALID_CREDENTIALS', 'Email/telepon atau kata sandi tidak cocok.')
    const contact = String(input.contact ?? '').trim()
    const result = await pool.query(`SELECT id,name,email,phone,email_verified_at,phone_verified_at,password_hash,status,mfa_enabled,mfa_secret_encrypted FROM users
      WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1`, [contact])
    if (!result.rowCount || !(await Bun.password.verify(password, result.rows[0].password_hash))) {
      apiError(401, 'INVALID_CREDENTIALS', 'Email/telepon atau kata sandi tidak cocok.')
    }
    const account = result.rows[0]
    if (account.status === 'disabled') apiError(403, 'ACCOUNT_DISABLED', 'Akun ini sedang dinonaktifkan.')
    const roles = await pool.query('SELECT role,pharmacy_id FROM user_roles WHERE user_id=$1', [account.id])
    const internal = roles.rows.some((entry:any)=>entry.role!=='customer')
    if(internal){
      if(!account.mfa_enabled||!account.mfa_secret_encrypted)apiError(403,'MFA_SETUP_REQUIRED','Akun internal memerlukan MFA sebelum dapat digunakan.')
      let valid=false
      try{valid=verifyTotp(decryptMfaSecret(account.mfa_secret_encrypted),String(input.mfaCode??''))}catch{apiError(503,'MFA_UNAVAILABLE','Konfigurasi keamanan MFA belum tersedia.')}
      if(!valid&&String(input.mfaCode??'').length>=16){
        const recovery=await pool.query('UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id',[account.id,hash(String(input.mfaCode).trim().toUpperCase())])
        valid=Boolean(recovery.rowCount)
      }
      if(!valid)apiError(401,'MFA_REQUIRED','Masukkan kode 6 digit dari aplikasi autentikator.')
    }
    const session = await createSession(account.id)
    const loggedIn: User = { ...account, roles: roles.rows.map((r: any) => ({ role: r.role, pharmacyId: r.pharmacy_id })), csrfToken: session.csrf }
    return json({ user: userJson(loggedIn) }, 200, { 'set-cookie': sessionCookie(session.token) })
  }

  if (path === '/auth/logout' && method === 'POST') {
    const token = cookieValue(request, 'apotek_session')
    if (token) await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE session_token_hash=$1', [hash(token)])
    return json({ message: 'Anda telah keluar.' }, 200, { 'set-cookie': expiredCookie() })
  }

  // Catalog and provider webhook URLs are public; an adapter must verify signatures before processing.
  if (path === '/products' && method === 'GET') {
    const query = (url.searchParams.get('query') ?? '').trim().slice(0, 100)
    const category = url.searchParams.get('category')
    const result = await pool.query(`SELECT p.id,p.sku,p.name,p.description,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,
      COALESCE(MIN(i.unit_price),0) AS indicative_price,COALESCE(MAX(i.on_hand-i.reserved),0) AS available
      FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.sales_blocked=false
      JOIN pharmacies ph ON ph.id=i.pharmacy_id AND ph.status='active'
      WHERE p.status='active' AND lower(p.category) NOT IN ('narkotika','psikotropika') AND ($1='' OR p.name ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%' OR p.category ILIKE '%'||$1||'%')
      AND ($2::text IS NULL OR p.category=$2) GROUP BY p.id ORDER BY p.category,p.name LIMIT 100`, [query, category || null])
    return json({ items: result.rows.map(publicProduct), categories: [...new Set(result.rows.map((r: any) => r.category))] })
  }
  const publicProductMatch = path.match(/^\/products\/([0-9a-f-]+)$/i)
  if (publicProductMatch && method === 'GET') {
    const result = await pool.query(`SELECT p.*,COALESCE(MIN(i.unit_price),0) indicative_price,COALESCE(MAX(i.on_hand-i.reserved),0) available
      FROM products p LEFT JOIN inventory i ON i.product_id=p.id AND i.sales_blocked=false
      WHERE p.id=$1 AND p.status='active' AND lower(p.category) NOT IN ('narkotika','psikotropika') GROUP BY p.id`, [publicProductMatch[1]])
    if (!result.rowCount) apiError(404, 'NOT_FOUND', 'Produk tidak ditemukan.')
    return json(publicProduct(result.rows[0]))
  }
  if (/^\/webhooks\/(payment|shipping)\/[a-z0-9_-]+$/i.test(path) && method === 'POST') {
    apiError(503, 'PROVIDER_NOT_CONFIGURED', 'Adapter penyedia belum dikonfigurasi.')
  }

  const currentUser = requireUser(user)

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
      await addHistory(client,order.id,null,status,currentUser.id,'Pesanan dibuat')
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
  if (orderGet && method === 'GET') return json(await getOrder(pool,orderGet[1],currentUser))

  const uploadMatch = path.match(/^\/orders\/([0-9a-f-]+)\/prescriptions$/i)
  if (uploadMatch && method === 'POST') {
    limit(request, 'prescription-upload', 10)
    const orderId = uploadMatch[1]
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) apiError(400,'FILE_REQUIRED','Pilih foto atau PDF resep terlebih dahulu.')
    if (file.size < 1 || file.size > UPLOAD_MAX_BYTES) apiError(413,'FILE_TOO_LARGE','Ukuran berkas melebihi batas yang diizinkan.')
    const ext = extname(csvSafeName(file.name)).toLowerCase()
    const mimeAllowed = new Map([['image/jpeg','.jpg'],['image/png','.png'],['application/pdf','.pdf']])
    if (!mimeAllowed.has(file.type) || !['.jpg','.jpeg','.png','.pdf'].includes(ext)) apiError(400,'FILE_TYPE_NOT_ALLOWED','Format yang didukung: JPG, PNG, atau PDF.')
    const data = Buffer.from(await file.arrayBuffer())
    const detected = ext === '.pdf' ? data.subarray(0,5).toString() === '%PDF-' : ext === '.png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : data.subarray(0,3).equals(Buffer.from([255,216,255]))
    if (!detected) apiError(400,'INVALID_FILE','Isi berkas tidak sesuai dengan formatnya.')
    let savedFile: string | null = null
    try {
      const saved = await transaction(async (client) => {
        const orderResult = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])
        if (!orderResult.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
        const order = orderResult.rows[0]
        if (order.customer_id !== currentUser.id) apiError(403,'FORBIDDEN','Pesanan ini bukan milik Anda.')
        if (order.status !== 'awaiting_prescription') apiError(409,'REVIEW_LOCKED','Unggahan resep hanya dapat diubah sebelum tagihan dibuat.')
        const objectKey = `${orderId}/${randomUUID()}${mimeAllowed.get(file.type)}`
        const filePath = join(process.cwd(),'storage','prescriptions',objectKey)
        await mkdir(join(process.cwd(),'storage','prescriptions',orderId),{recursive:true})
        savedFile = filePath
        await Bun.write(filePath,data)
        const revision = Number(order.document_revision)+1
        const inserted = await client.query(`INSERT INTO prescriptions(order_id,uploaded_by,object_key,original_filename,mime_type,document_revision,document_sha256,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id,created_at`,[orderId,currentUser.id,objectKey,csvSafeName(file.name),file.type,revision,hash(data)])
        await client.query('UPDATE orders SET document_revision=$2,review_version=review_version+1,updated_at=now() WHERE id=$1',[orderId,revision])
        await audit(client,currentUser.id,'prescription.uploaded','prescription',inserted.rows[0].id,{revision})
        return { id:inserted.rows[0].id,revision,uploadedAt:inserted.rows[0].created_at }
      })
      return json(saved,201)
    } catch (error) {
      if (savedFile) await unlink(savedFile).catch(()=>{})
      throw error
    }
  }

  const fileMatch = path.match(/^\/prescriptions\/([0-9a-f-]+)\/file$/i)
  if (fileMatch && method === 'GET') {
    const result = await pool.query(`SELECT p.*,o.customer_id,o.pharmacy_id FROM prescriptions p JOIN orders o ON o.id=p.order_id WHERE p.id=$1`,[fileMatch[1]])
    if (!result.rowCount) apiError(404,'NOT_FOUND','Berkas tidak ditemukan.')
    const prescription = result.rows[0]
    if (prescription.customer_id !== currentUser.id) {
      if (!hasRole(currentUser,'pharmacist')) apiError(403,'FORBIDDEN','Akses berkas tidak diizinkan.')
      pharmacyScope(currentUser,prescription.pharmacy_id)
    }
    const filePath = join(process.cwd(),'storage','prescriptions',prescription.object_key)
    const file = Bun.file(filePath)
    if (!(await file.exists())) apiError(404,'FILE_MISSING','Berkas tidak tersedia.')
    await pool.query("INSERT INTO audit_log(actor_id,action,resource_type,resource_id,metadata) VALUES($1,'prescription.viewed','prescription',$2,'{}')",[currentUser.id,prescription.id])
    return new Response(file,{headers:{'content-type':prescription.mime_type,'content-disposition':'inline','cache-control':'private, no-store','x-content-type-options':'nosniff'}})
  }

  const reviewMatch = path.match(/^\/prescriptions\/([0-9a-f-]+)\/reviews$/i)
  if (reviewMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist')
    const input = await body<any>(request)
    if (!['approved','clarification','rejected'].includes(input.decision)) apiError(400,'INVALID_DECISION','Keputusan tidak valid.')
    if(['clarification','rejected'].includes(input.decision)&&String(input.reason??'').trim().length<3)apiError(422,'REVIEW_REASON_REQUIRED','Catatan diperlukan untuk klarifikasi atau penolakan resep.')
    const result = await transaction(async (client) => {
      const selected = await client.query(`SELECT p.*,o.id AS order_id,o.pharmacy_id,o.status AS order_status,o.document_revision AS current_document_revision,o.review_version,o.expires_at
        FROM prescriptions p JOIN orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF o,p`,[reviewMatch[1]])
      if (!selected.rowCount) apiError(404,'NOT_FOUND','Dokumen resep tidak ditemukan.')
      const p = selected.rows[0]
      pharmacyScope(currentUser,p.pharmacy_id)
      if (p.order_status !== 'awaiting_prescription' || Number(p.document_revision) !== Number(p.current_document_revision)) apiError(409,'REVIEW_LOCKED','Pemeriksaan resep sudah dikunci atau ada revisi dokumen baru.')
      if (Number(input.expectedReviewVersion) !== Number(p.review_version)) apiError(409,'REVIEW_CONFLICT','Resep sudah ditinjau oleh petugas lain. Muat ulang antrean.')
      if (new Date(p.expires_at).getTime() <= Date.now()) apiError(409,'ORDER_EXPIRED','Reservasi pesanan sudah berakhir.')
      const orderItems = await client.query('SELECT id,requires_prescription_snapshot FROM order_items WHERE order_id=$1',[p.order_id])
      const requiredIds = orderItems.rows.filter((i:any)=>i.requires_prescription_snapshot).map((i:any)=>i.id)
      const reviewedIds = [...new Set((input.orderItemIds ?? []).map(String))]
      if (!reviewedIds.length || reviewedIds.some((id:string)=>!requiredIds.includes(id))) apiError(400,'INVALID_REVIEW_ITEMS','Pilih item resep pada pesanan ini.')
      if (input.decision === 'approved' && requiredIds.some((id:string)=>!reviewedIds.includes(id))) apiError(422,'REVIEW_INCOMPLETE','Persetujuan harus mencakup seluruh item wajib resep.')
      const sequence = Number(p.review_version)+1
      const review = await client.query(`INSERT INTO prescription_reviews(prescription_id,pharmacist_id,document_revision,review_sequence,decision,reason)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[p.id,currentUser.id,p.document_revision,sequence,input.decision,String(input.reason ?? '').trim() || null])
      for (const itemId of reviewedIds) await client.query('INSERT INTO review_items(review_id,order_item_id) VALUES($1,$2)',[review.rows[0].id,itemId])
      await client.query('UPDATE prescriptions SET status=$2 WHERE id=$1',[p.id,input.decision])
      if(input.decision==='clarification')await client.query("INSERT INTO prescription_messages(order_id,author_id,message_type,body) VALUES($1,$2,'clarification_request',$3)",[p.order_id,currentUser.id,String(input.reason).trim()])
      await client.query('UPDATE orders SET review_version=$2,updated_at=now() WHERE id=$1',[p.order_id,sequence])
      let status = p.order_status
      if (input.decision === 'rejected') {
        await client.query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",[p.order_id])
        const active=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",[p.order_id])
        for(const reservation of active.rows){
          await client.query("UPDATE stock_reservations SET status='released' WHERE id=$1",[reservation.id])
          await client.query('UPDATE inventory SET reserved=reserved-$3 WHERE pharmacy_id=$1 AND product_id=$2',[reservation.pharmacy_id,reservation.product_id,reservation.quantity])
        }
        await addHistory(client,p.order_id,p.order_status,'cancelled',currentUser.id,'Resep ditolak oleh apoteker')
        status='cancelled'
      } else if (input.decision === 'approved') {
        const latest = await client.query(`SELECT oi.id,rv.decision,rv.document_revision FROM order_items oi
          LEFT JOIN LATERAL (SELECT pr.decision,pr.document_revision FROM review_items ri JOIN prescription_reviews pr ON pr.id=ri.review_id
            JOIN prescriptions ps ON ps.id=pr.prescription_id WHERE ri.order_item_id=oi.id AND ps.order_id=$1
            ORDER BY pr.review_sequence DESC LIMIT 1) rv ON true
          WHERE oi.order_id=$1 AND oi.requires_prescription_snapshot=true`,[p.order_id])
        if (latest.rows.length === requiredIds.length && latest.rows.every((row:any)=>row.decision==='approved' && Number(row.document_revision)===Number(p.document_revision)) && new Date(p.expires_at).getTime()>Date.now()) {
          await client.query("UPDATE orders SET status='awaiting_payment',updated_at=now() WHERE id=$1",[p.order_id])
          await addHistory(client,p.order_id,'awaiting_prescription','awaiting_payment',currentUser.id,'Seluruh item wajib resep disetujui')
          status='awaiting_payment'
        }
      }
      await audit(client,currentUser.id,'prescription.reviewed','prescription',p.id,{decision:input.decision,revision:p.document_revision,sequence})
      return { prescriptionId:p.id,decision:input.decision,reviewVersion:sequence,orderStatus:status }
    })
    return json(result)
  }

  const messagesMatch = path.match(/^\/orders\/([0-9a-f-]+)\/prescription-messages$/i)
  if (messagesMatch && method === 'GET') {
    const order = await pool.query('SELECT customer_id,pharmacy_id FROM orders WHERE id=$1',[messagesMatch[1]])
    if (!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if (order.rows[0].customer_id !== currentUser.id) { requireRole(currentUser,'pharmacist'); pharmacyScope(currentUser,order.rows[0].pharmacy_id) }
    const result = await pool.query('SELECT id,author_id,message_type,body,created_at FROM prescription_messages WHERE order_id=$1 ORDER BY created_at',[messagesMatch[1]])
    return json({items:result.rows.map((m:any)=>({id:m.id,authorId:m.author_id,type:m.message_type,body:m.body,createdAt:m.created_at}))})
  }
  if (messagesMatch && method === 'POST') {
    const order = await pool.query('SELECT customer_id,pharmacy_id,status FROM orders WHERE id=$1',[messagesMatch[1]])
    if (!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    const isCustomer = order.rows[0].customer_id === currentUser.id
    if (!isCustomer) { requireRole(currentUser,'pharmacist'); pharmacyScope(currentUser,order.rows[0].pharmacy_id) }
    const input = await body<any>(request)
    const message = String(input.message ?? '').trim()
    if (!message || message.length > 2000) apiError(400,'INVALID_MESSAGE','Pesan klarifikasi wajib diisi dan maksimal 2.000 karakter.')
    const type = isCustomer ? 'customer_response' : 'clarification_request'
    if(isCustomer){
      if(order.rows[0].status!=='awaiting_prescription')apiError(409,'REVIEW_LOCKED','Klarifikasi hanya dapat dijawab sebelum pembayaran.')
      const open=await pool.query("SELECT 1 FROM prescriptions WHERE order_id=$1 AND status='clarification' LIMIT 1",[messagesMatch[1]])
      if(!open.rowCount)apiError(409,'NO_OPEN_CLARIFICATION','Belum ada permintaan klarifikasi yang perlu dijawab.')
    }
    const result = await pool.query('INSERT INTO prescription_messages(order_id,author_id,message_type,body) VALUES($1,$2,$3,$4) RETURNING id,created_at',[messagesMatch[1],currentUser.id,type,message])
    return json({id:result.rows[0].id,type,createdAt:result.rows[0].created_at},201)
  }

  const paymentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/payments$/i)
  if (paymentMatch && method === 'POST') {
    const order = await pool.query('SELECT customer_id,status,expires_at FROM orders WHERE id=$1',[paymentMatch[1]])
    if (!order.rowCount || order.rows[0].customer_id !== currentUser.id) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if (!['awaiting_payment'].includes(order.rows[0].status) || new Date(order.rows[0].expires_at).getTime() <= Date.now()) apiError(409,'INVALID_ORDER_STATE','Pesanan belum memenuhi syarat untuk tagihan.')
    apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Penyedia pembayaran belum dipilih dan dikonfigurasi. Pesanan tetap aman; hubungi operasional untuk menyiapkan integrasi.')
  }
  const paymentWebhook = path.match(/^\/webhooks\/payment\/([a-z0-9_-]+)$/i)
  if (paymentWebhook && method === 'POST') apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Adapter pembayaran belum dikonfigurasi.')
  const refundMatch=path.match(/^\/payments\/([0-9a-f-]+)\/refunds$/i)
  if(refundMatch&&method==='POST'){
    requireRole(currentUser,'finance','admin')
    const input=await body<any>(request)
    const refundAmount=Number(input.amount)
    const reason=String(input.reason??'').trim()
    if(!Number.isFinite(refundAmount)||refundAmount<=0||reason.length<3||reason.length>500)apiError(400,'INVALID_REFUND','Nominal dan alasan refund diperlukan.')
    const payment=await pool.query('SELECT id,status,received_amount FROM payments WHERE id=$1',[refundMatch[1]])
    if(!payment.rowCount)apiError(404,'NOT_FOUND','Pembayaran tidak ditemukan.')
    if(!['succeeded','late'].includes(payment.rows[0].status)||payment.rows[0].received_amount==null)apiError(409,'PAYMENT_NOT_RECEIVED','Dana terverifikasi belum tersedia untuk refund.')
    const requested=await pool.query("SELECT COALESCE(SUM(amount),0) amount FROM refunds WHERE payment_id=$1 AND status IN ('requested','processing','succeeded')",[refundMatch[1]])
    if(cents(requested.rows[0].amount)+cents(refundAmount)>cents(payment.rows[0].received_amount))apiError(409,'REFUND_LIMIT_EXCEEDED','Nominal refund melebihi dana yang diterima.')
    apiError(503,'PAYMENT_PROVIDER_NOT_CONFIGURED','Adapter refund belum dikonfigurasi. Permintaan belum dikirim dan dana belum berubah.')
  }
  const shippingWebhook = path.match(/^\/webhooks\/shipping\/([a-z0-9_-]+)$/i)
  if (shippingWebhook && method === 'POST') apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Adapter pengiriman belum dikonfigurasi.')

  const fulfillmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment$/i)
  if (fulfillmentMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const input = await body<any>(request)
    const result = await transaction(async (client) => {
      const selected = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[fulfillmentMatch[1]])
      if (!selected.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      const order=selected.rows[0]
      pharmacyScope(currentUser,order.pharmacy_id)
      if (input.command === 'start_processing') {
        if (order.status !== 'paid') apiError(409,'INVALID_ORDER_STATE','Pesanan harus sudah dibayar sebelum diproses.')
        const paid=await client.query("SELECT 1 FROM payments WHERE order_id=$1 AND status='succeeded' AND received_amount=amount",[order.id])
        if (!paid.rowCount) apiError(409,'PAYMENT_NOT_CONFIRMED','Pembayaran belum terkonfirmasi penuh oleh penyedia.')
        await client.query("UPDATE orders SET status='processing',updated_at=now() WHERE id=$1",[order.id])
        await addHistory(client,order.id,'paid','processing',currentUser.id)
      } else if (input.command === 'mark_ready') {
        if (order.status !== 'processing') apiError(409,'INVALID_ORDER_STATE','Pesanan harus sedang diproses.')
        const checks=await client.query(`SELECT fc.id,fc.passed,fc.pharmacist_check FROM fulfillment_checks fc WHERE fc.order_id=$1 ORDER BY checked_at DESC LIMIT 1`,[order.id])
        if (!checks.rowCount || !checks.rows[0].passed) apiError(422,'FULFILLMENT_CHECK_REQUIRED','Pemeriksaan kesesuaian produk harus lulus sebelum pesanan siap.')
        const hasRx=await client.query('SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true LIMIT 1',[order.id])
        if (hasRx.rowCount && !checks.rows[0].pharmacist_check) apiError(403,'PHARMACIST_CHECK_REQUIRED','Pemeriksaan akhir pesanan resep harus dicatat apoteker.')
        const consumed=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' ORDER BY product_id FOR UPDATE",[order.id])
        for (const r of consumed.rows) {
          const update=await client.query('UPDATE inventory SET on_hand=on_hand-$3,reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2 AND on_hand >= $3 AND reserved >= $3',[r.pharmacy_id,r.product_id,r.quantity])
          if (!update.rowCount) apiError(409,'INVENTORY_MISMATCH','Alokasi daring tidak cocok. Pemenuhan dihentikan untuk rekonsiliasi.')
          await client.query("UPDATE stock_reservations SET status='consumed' WHERE id=$1",[r.id])
          await client.query("INSERT INTO inventory_movements(pharmacy_id,product_id,order_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,'fulfillment',$5)",[r.pharmacy_id,r.product_id,order.id,-Number(r.quantity),currentUser.id])
        }
        await client.query("UPDATE orders SET status='ready',updated_at=now() WHERE id=$1",[order.id])
        await addHistory(client,order.id,'processing','ready',currentUser.id)
      } else if (input.command === 'confirm_pickup') {
        if (order.fulfillment_method !== 'pickup' || order.status !== 'ready') apiError(409,'INVALID_ORDER_STATE','Hanya pesanan ambil di apotek yang siap dapat diselesaikan.')
        const proofReference=String(input.proofReference??'').trim()
        if (!input.pickupCode || String(input.pickupCode).toUpperCase() !== order.pickup_code || !proofReference || proofReference.length>200) apiError(422,'PICKUP_PROOF_REQUIRED','Kode pengambilan dan referensi bukti wajib cocok.')
        await client.query("UPDATE orders SET status='completed',updated_at=now() WHERE id=$1",[order.id])
        await client.query("INSERT INTO shipments(order_id,method,status,handover_reference) VALUES($1,'pickup','completed',$2) ON CONFLICT(order_id) DO UPDATE SET status='completed',handover_reference=EXCLUDED.handover_reference",[order.id,proofReference])
        await addHistory(client,order.id,'ready','completed',currentUser.id,'pickup')
        input.proofReference=proofReference
      } else if (input.command === 'handover_to_courier') {
        apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Penyedia pengiriman belum dikonfigurasi.')
      } else apiError(400,'INVALID_COMMAND','Perintah pemenuhan tidak dikenal.')
      await audit(client,currentUser.id,`fulfillment.${input.command}`,'order',order.id,input.command==='confirm_pickup'?{proofReference:input.proofReference}:{})
      return { orderId:order.id, status:input.command==='start_processing'?'processing':input.command==='mark_ready'?'ready':'completed' }
    })
    return json(result)
  }
  const checkMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment-checks$/i)
  if (checkMatch && method === 'POST') {
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const input=await body<any>(request)
    const result=await transaction(async(client)=>{
      const order=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[checkMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      pharmacyScope(currentUser,order.rows[0].pharmacy_id)
      if(order.rows[0].status!=='processing') apiError(409,'INVALID_ORDER_STATE','Pemeriksaan hanya tersedia saat penyiapan.')
      const items=await client.query('SELECT id,quantity FROM order_items WHERE order_id=$1',[checkMatch[1]])
      const supplied=Array.isArray(input.items)?input.items:[]
      if(supplied.length!==items.rows.length || items.rows.some((i:any)=>!supplied.some((s:any)=>s.orderItemId===i.id && Number(s.quantity)===Number(i.quantity)))) apiError(422,'ITEM_CHECK_INCOMPLETE','Periksa semua item dan jumlah yang dipesan.')
      const hasRx=await client.query('SELECT 1 FROM order_items WHERE order_id=$1 AND requires_prescription_snapshot=true',[checkMatch[1]])
      const pharmacistCheck=hasRole(currentUser,'pharmacist') && input.pharmacistCheck===true
      const passed=input.passed===true
      const checkNote=String(input.note??'').trim().slice(0,1000)
      if(!passed&&checkNote.length<3)apiError(422,'FULFILLMENT_NOTE_REQUIRED','Jelaskan kendala pemeriksaan sebelum mengeskalasikannya.')
      if(hasRx.rowCount && !pharmacistCheck && passed) apiError(403,'PHARMACIST_CHECK_REQUIRED','Pemeriksaan akhir untuk pesanan resep hanya dapat dicatat apoteker.')
      const batchItems=await client.query('SELECT id,quantity,batch_tracking_required_snapshot FROM order_items WHERE order_id=$1',[checkMatch[1]])
      const lotPlans:any[]=[]
      if(passed){
        for(const orderItem of batchItems.rows){
          if(!orderItem.batch_tracking_required_snapshot)continue
          const entry=supplied.find((item:any)=>item.orderItemId===orderItem.id)
          const lots=Array.isArray(entry?.lots)?entry.lots:[]
          if(!lots.length)apiError(422,'LOT_REQUIRED','Catat nomor batch dan tanggal kedaluwarsa untuk setiap produk yang memerlukan pelacakan.')
          let lotQuantity=0
          for(const lot of lots){
            const lotNumber=String(lot.lotNumber??'').trim()
            const expiresOn=String(lot.expiresOn??'').trim()
            const quantity=Number(lot.quantity)
            if(!lotNumber||lotNumber.length>120||!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)||!Number.isInteger(quantity)||quantity<1)apiError(422,'LOT_INVALID','Nomor batch, tanggal kedaluwarsa, dan jumlah unit harus diisi dengan benar.')
            const dateParts=expiresOn.split('-').map(Number)
            const parsedDate=new Date(Date.UTC(dateParts[0],dateParts[1]-1,dateParts[2]))
            if(parsedDate.getUTCFullYear()!==dateParts[0]||parsedDate.getUTCMonth()+1!==dateParts[1]||parsedDate.getUTCDate()!==dateParts[2])apiError(422,'LOT_INVALID','Tanggal kedaluwarsa tidak valid.')
            const expiry=await client.query('SELECT $1::date>=CURRENT_DATE AS valid',[expiresOn])
            if(!expiry.rows[0].valid)apiError(422,'LOT_EXPIRED','Tanggal kedaluwarsa produk sudah lewat.')
            lotQuantity+=quantity
            lotPlans.push({orderItemId:orderItem.id,lotNumber,expiresOn,quantity})
          }
          if(lotQuantity!==Number(orderItem.quantity))apiError(422,'LOT_QUANTITY_MISMATCH','Jumlah unit pada catatan batch harus sama dengan jumlah pesanan.')
        }
      }
      const inserted=await client.query(`INSERT INTO fulfillment_checks(order_id,actor_id,pharmacist_check,passed,note)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[checkMatch[1],currentUser.id,pharmacistCheck,passed,checkNote||null])
      for(const lot of lotPlans)await client.query('INSERT INTO dispensed_lots(fulfillment_check_id,order_item_id,lot_number,expires_on,quantity) VALUES($1,$2,$3,$4,$5)',[inserted.rows[0].id,lot.orderItemId,lot.lotNumber,lot.expiresOn,lot.quantity])
      if(!passed){
        const activeCase=await client.query("SELECT id FROM support_cases WHERE order_id=$1 AND category='fulfillment' AND status<>'closed' LIMIT 1",[checkMatch[1]])
        if(!activeCase.rowCount){
          const opened=await client.query("INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,'fulfillment',$3) RETURNING id",[checkMatch[1],currentUser.id,`Pemeriksaan pemenuhan gagal: ${checkNote}`])
          await audit(client,currentUser.id,'support.opened','support_case',opened.rows[0].id,{category:'fulfillment'})
        }
      }
      await audit(client,currentUser.id,'fulfillment.checked','order',checkMatch[1],{passed,pharmacistCheck})
      return {id:inserted.rows[0].id,passed,pharmacistCheck,escalated:!passed}
    })
    return json(result,201)
  }

  const shipmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/shipment-bookings$/i)
  if(shipmentMatch&&method==='POST'){
    requireRole(currentUser,'pharmacist','pharmacy_staff')
    const order=await pool.query('SELECT pharmacy_id,fulfillment_method,status FROM orders WHERE id=$1',[shipmentMatch[1]])
    if(!order.rowCount)apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    pharmacyScope(currentUser,order.rows[0].pharmacy_id)
    if(order.rows[0].fulfillment_method!=='delivery'||order.rows[0].status!=='ready')apiError(409,'INVALID_ORDER_STATE','Hanya pesanan pengiriman yang siap dapat dibuatkan booking.')
    apiError(503,'SHIPPING_PROVIDER_NOT_CONFIGURED','Penyedia pengiriman belum dikonfigurasi.')
  }

  const cancellationMatch=path.match(/^\/orders\/([0-9a-f-]+)\/cancellation-requests$/i)
  if(cancellationMatch&&method==='POST'){
    const input=await body<any>(request)
    const reason=String(input.reason??'').trim()
    if(reason.length<3||reason.length>500) apiError(400,'INVALID_REASON','Alasan pembatalan wajib diisi.')
    const result=await transaction(async(client)=>{
      const order=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[cancellationMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','admin')) apiError(403,'FORBIDDEN','Tidak dapat meminta pembatalan pesanan ini.')
      if(!['awaiting_prescription','awaiting_payment','paid','processing','ready'].includes(order.rows[0].status)) apiError(409,'CANCELLATION_NOT_ALLOWED','Pesanan sudah diserahkan atau berakhir. Buat kasus bantuan.')
      const existing=await client.query("SELECT id,status FROM cancellation_requests WHERE order_id=$1 AND status='requested'",[cancellationMatch[1]])
      if(existing.rowCount)return existing.rows[0]
      const saved=await client.query("INSERT INTO cancellation_requests(order_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id,status",[cancellationMatch[1],currentUser.id,reason])
      await audit(client,currentUser.id,'cancellation.requested','order',cancellationMatch[1],{requestId:saved.rows[0].id})
      return saved.rows[0]
    })
    return json(result,201)
  }
  const cancellationDecision=path.match(/^\/cancellation-requests\/([0-9a-f-]+)\/decision$/i)
  if(cancellationDecision&&method==='POST'){
    requireRole(currentUser,'cs','admin')
    const input=await body<any>(request)
    const result=await transaction(async(client)=>{
      const req=await client.query('SELECT cr.*,o.status AS order_status,o.pharmacy_id FROM cancellation_requests cr JOIN orders o ON o.id=cr.order_id WHERE cr.id=$1 FOR UPDATE OF cr,o',[cancellationDecision[1]])
      if(!req.rowCount) apiError(404,'NOT_FOUND','Permintaan pembatalan tidak ditemukan.')
      if(req.rows[0].status!=='requested') apiError(409,'ALREADY_DECIDED','Permintaan pembatalan sudah diputuskan.')
      const approve=input.decision==='approved'
      if(!approve&&input.decision!=='rejected') apiError(400,'INVALID_DECISION','Keputusan tidak valid.')
      if(approve&&!['awaiting_prescription','awaiting_payment','paid','processing','ready'].includes(req.rows[0].order_status)) apiError(409,'CANCELLATION_NOT_ALLOWED','Pesanan sudah diserahkan atau berakhir.')
      const next=approve?'approved':'rejected'
      await client.query('UPDATE cancellation_requests SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now() WHERE id=$1',[cancellationDecision[1],next,currentUser.id,String(input.reason??'').slice(0,500)||null])
      if(approve){
        const orderId=req.rows[0].order_id
        const active=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",[orderId])
        for(const r of active.rows){
          await client.query("UPDATE stock_reservations SET status='released' WHERE id=$1",[r.id])
          await client.query('UPDATE inventory SET reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',[r.pharmacy_id,r.product_id,r.quantity])
        }
        await client.query("UPDATE orders SET status='cancelled',updated_at=now() WHERE id=$1",[orderId])
        await addHistory(client,orderId,req.rows[0].order_status,'cancelled',currentUser.id,'Pembatalan disetujui')
        if(['paid','processing','ready'].includes(req.rows[0].order_status)) await client.query("INSERT INTO support_cases(order_id,opened_by,category,description) SELECT $1,$2,'refund','Pembatalan disetujui; proses refund perlu ditangani finance.'",[orderId,currentUser.id])
      }
      await audit(client,currentUser.id,'cancellation.decided','cancellation_request',cancellationDecision[1],{decision:next})
      return {id:cancellationDecision[1],status:next}
    })
    return json(result)
  }

  const casesMatch=path.match(/^\/orders\/([0-9a-f-]+)\/support-cases$/i)
  if(casesMatch&&method==='GET'){
    const order=await pool.query('SELECT customer_id,pharmacy_id FROM orders WHERE id=$1',[casesMatch[1]])
    if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
    if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','finance','admin')) pharmacyScope(currentUser,order.rows[0].pharmacy_id)
    const result=await pool.query('SELECT id,category,status,description,created_at,updated_at FROM support_cases WHERE order_id=$1 ORDER BY created_at DESC',[casesMatch[1]])
    return json({items:result.rows})
  }
  if(casesMatch&&method==='POST'){
    const input=await body<any>(request)
    const description=String(input.description??'').trim()
    const category=String(input.category??'other').slice(0,50)
    if(description.length<4||description.length>2000) apiError(400,'INVALID_CASE','Jelaskan kendala dengan singkat.')
    const saved=await transaction(async(client)=>{
      const order=await client.query('SELECT customer_id FROM orders WHERE id=$1',[casesMatch[1]])
      if(!order.rowCount) apiError(404,'NOT_FOUND','Pesanan tidak ditemukan.')
      if(order.rows[0].customer_id!==currentUser.id&&!hasRole(currentUser,'cs','finance','admin')) apiError(403,'FORBIDDEN','Tidak dapat membuka kasus untuk pesanan ini.')
      const result=await client.query('INSERT INTO support_cases(order_id,opened_by,category,description) VALUES($1,$2,$3,$4) RETURNING id,status,created_at',[casesMatch[1],currentUser.id,category,description])
      await audit(client,currentUser.id,'support.opened','support_case',result.rows[0].id,{orderId:casesMatch[1]})
      return result.rows[0]
    })
    return json(saved,201)
  }
  const caseMatch=path.match(/^\/support-cases\/([0-9a-f-]+)$/i)
  if(caseMatch&&method==='PATCH'){
    requireRole(currentUser,'cs','finance','admin')
    const input=await body<any>(request)
    if(!['open','in_progress','closed'].includes(input.status)) apiError(400,'INVALID_STATUS','Status kasus tidak valid.')
    const assignedTo=input.assignedTo&&validUuid(String(input.assignedTo))?String(input.assignedTo):currentUser.id
    const saved=await transaction(async(client)=>{
      const assignee=await client.query("SELECT 1 FROM user_roles WHERE user_id=$1 AND role IN ('admin','cs','finance') LIMIT 1",[assignedTo])
      if(!assignee.rowCount)apiError(400,'INVALID_ASSIGNEE','Penanggung jawab harus akun operasional.')
      const result=await client.query('UPDATE support_cases SET status=$2,assigned_to=$3,updated_at=now() WHERE id=$1 RETURNING id,status,updated_at',[caseMatch[1],input.status,assignedTo])
      if(!result.rowCount) apiError(404,'NOT_FOUND','Kasus bantuan tidak ditemukan.')
      await audit(client,currentUser.id,'support.updated','support_case',caseMatch[1],{status:input.status,assignedTo})
      return result.rows[0]
    })
    return json(saved)
  }

  if(path==='/admin/products'&&method==='GET'){
    requireRole(currentUser,'admin','pharmacist')
    const result=await pool.query(`SELECT p.id,p.sku,p.name,p.description,p.category,p.sell_unit,p.requires_prescription,p.batch_tracking_required,p.status,
      COALESCE(MIN(i.unit_price),0) indicative_price,COALESCE(MAX(i.on_hand-i.reserved),0) available
      FROM products p LEFT JOIN (SELECT inventory.* FROM inventory JOIN pharmacies ON pharmacies.id=inventory.pharmacy_id WHERE pharmacies.status='active') i ON i.product_id=p.id
      GROUP BY p.id ORDER BY p.category,p.name`)
    return json({items:result.rows.map((r:any)=>({...publicProduct(r),status:r.status}))})
  }
  if(path==='/admin/pharmacies'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT id,name,address_text,city,postal_codes,status,license_reference,created_at
      FROM pharmacies ORDER BY created_at DESC`)
    return json({items:result.rows.map((p:any)=>({id:p.id,name:p.name,addressText:p.address_text,city:p.city,postalCodes:p.postal_codes,status:p.status,licenseReference:p.license_reference,createdAt:p.created_at}))})
  }
  if(path==='/admin/orders'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT o.id,o.status,o.fulfillment_method,o.total,o.created_at,o.expires_at,p.name customer_name,ph.name pharmacy_name
      FROM orders o JOIN users p ON p.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id ORDER BY o.created_at DESC LIMIT 200`)
    return json({items:result.rows.map((r:any)=>({id:r.id,status:r.status,fulfillmentMethod:r.fulfillment_method,total:amount(r.total),createdAt:r.created_at,expiresAt:r.expires_at,customerName:r.customer_name,pharmacyName:r.pharmacy_name}))})
  }
  if(path==='/admin/cancellation-requests'&&method==='GET'){
    requireRole(currentUser,'admin','cs')
    const result=await pool.query(`SELECT cr.id,cr.order_id,cr.reason,cr.status,cr.created_at,o.status AS order_status,o.total,u.name AS customer_name,ph.name AS pharmacy_name
      FROM cancellation_requests cr JOIN orders o ON o.id=cr.order_id JOIN users u ON u.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id
      WHERE cr.status='requested' ORDER BY cr.created_at`)
    return json({items:result.rows.map((r:any)=>({id:r.id,orderId:r.order_id,reason:r.reason,status:r.status,orderStatus:r.order_status,total:amount(r.total),customerName:r.customer_name,pharmacyName:r.pharmacy_name,createdAt:r.created_at}))})
  }
  if(path==='/admin/support-cases'&&method==='GET'){
    requireRole(currentUser,'admin','cs','finance')
    const result=await pool.query(`SELECT c.id,c.order_id,c.category,c.status,c.description,c.created_at,o.status AS order_status,u.name AS customer_name,ph.name AS pharmacy_name
      FROM support_cases c JOIN orders o ON o.id=c.order_id JOIN users u ON u.id=o.customer_id JOIN pharmacies ph ON ph.id=o.pharmacy_id
      WHERE c.status<>'closed' ORDER BY c.created_at`)
    return json({items:result.rows.map((r:any)=>({id:r.id,orderId:r.order_id,category:r.category,status:r.status,description:r.description,createdAt:r.created_at,orderStatus:r.order_status,customerName:r.customer_name,pharmacyName:r.pharmacy_name}))})
  }
  if(path==='/admin/products'&&method==='POST'){
    requireRole(currentUser,'pharmacist')
    const input=await body<any>(request)
    const sku=String(input.sku??'').trim().toUpperCase()
    const name=String(input.name??'').trim()
    const category=String(input.category??'').trim()
    const sellUnit=String(input.sellUnit??'').trim()
    if(!/^[A-Z0-9_-]{2,40}$/.test(sku)||name.length<2||name.length>160||category.length<2||category.length>80||sellUnit.length<2||sellUnit.length>100)apiError(400,'INVALID_PRODUCT','SKU, nama, kategori, dan satuan jual harus diisi dengan benar.')
    const saved=await transaction(async(client)=>{
      const result=await client.query(`INSERT INTO products(sku,name,description,category,sell_unit,requires_prescription,batch_tracking_required,special_handling,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'inactive') RETURNING id,sku,name,status`,[sku,name,String(input.description??'').slice(0,3000),category,sellUnit,input.requiresPrescription===true,input.batchTrackingRequired===true,input.specialHandling===true])
      await audit(client,currentUser.id,'product.created','product',result.rows[0].id,{})
      return result.rows[0]
    })
    return json(saved,201)
  }
  if(path==='/admin/inventory'&&method==='POST'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    const pharmacyId=String(input.pharmacyId??'')
    const productId=String(input.productId??'')
    const onHand=Number(input.onHand)
    const unitPrice=Number(input.unitPrice)
    if(!validUuid(pharmacyId)||!validUuid(productId)||!Number.isInteger(onHand)||onHand<0||!Number.isFinite(unitPrice)||unitPrice<0)apiError(400,'INVALID_INVENTORY','Apotek, produk, alokasi, dan harga harus valid.')
    const result=await transaction(async(client)=>{
      const pharmacy=await client.query('SELECT status FROM pharmacies WHERE id=$1 FOR UPDATE',[pharmacyId])
      const product=await client.query('SELECT id FROM products WHERE id=$1 FOR SHARE',[productId])
      if(!pharmacy.rowCount||!product.rowCount)apiError(404,'NOT_FOUND','Apotek atau produk tidak ditemukan.')
      const existing=await client.query('SELECT on_hand,reserved FROM inventory WHERE pharmacy_id=$1 AND product_id=$2 FOR UPDATE',[pharmacyId,productId])
      const oldOnHand=existing.rowCount?Number(existing.rows[0].on_hand):0
      const reserved=existing.rowCount?Number(existing.rows[0].reserved):0
      if(onHand<reserved)apiError(409,'RESERVATION_CONFLICT','Alokasi baru tidak boleh lebih rendah dari stok yang sudah direservasi.')
      await client.query(`INSERT INTO inventory(pharmacy_id,product_id,on_hand,reserved,unit_price,sales_blocked)
        VALUES($1,$2,$3,0,$4,false) ON CONFLICT(pharmacy_id,product_id) DO UPDATE SET on_hand=EXCLUDED.on_hand,unit_price=EXCLUDED.unit_price,sales_blocked=false,updated_at=now()`,[pharmacyId,productId,onHand,unitPrice.toFixed(2)])
      const delta=onHand-oldOnHand
      if(delta!==0)await client.query('INSERT INTO inventory_movements(pharmacy_id,product_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[pharmacyId,productId,delta,String(input.reason??'Pengaturan alokasi daring').slice(0,500),currentUser.id])
      await audit(client,currentUser.id,'inventory.configured','product',productId,{pharmacyId,onHand,unitPrice:unitPrice.toFixed(2),reserved})
      return {pharmacyId,productId,onHand,reserved,available:onHand-reserved,unitPrice:unitPrice.toFixed(2)}
    })
    return json(result)
  }
  const adminProduct=path.match(/^\/admin\/products\/([0-9a-f-]+)$/i)
  if(adminProduct&&method==='PATCH'){
    requireRole(currentUser,'pharmacist')
    const input=await body<any>(request)
    const allowed=['name','description','category','sellUnit','requiresPrescription','batchTrackingRequired','specialHandling','status']
    if(Object.keys(input).some((key)=>!allowed.includes(key))) apiError(400,'INVALID_PRODUCT','Perubahan produk memuat field yang tidak didukung.')
    if(input.status!==undefined&&!['active','inactive'].includes(input.status))apiError(400,'INVALID_STATUS','Status produk tidak valid.')
    const saved=await transaction(async(client)=>{
      const r=await client.query(`UPDATE products SET name=COALESCE($2,name),description=COALESCE($3,description),category=COALESCE($4,category),
        sell_unit=COALESCE($5,sell_unit),requires_prescription=COALESCE($6,requires_prescription),batch_tracking_required=COALESCE($7,batch_tracking_required),special_handling=COALESCE($8,special_handling),
        status=COALESCE($9,status),updated_at=now() WHERE id=$1 RETURNING id,sku,name,status`,[adminProduct[1],input.name??null,input.description??null,input.category??null,input.sellUnit??null,input.requiresPrescription??null,input.batchTrackingRequired??null,input.specialHandling??null,input.status??null])
      if(!r.rowCount) apiError(404,'NOT_FOUND','Produk tidak ditemukan.')
      await audit(client,currentUser.id,'product.updated','product',r.rows[0].id,{})
      return r.rows[0]
    })
    return json(saved)
  }
  if(path==='/admin/pharmacies'&&method==='POST'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    const name=String(input.name??'').trim()
    const address=String(input.addressText??'').trim()
    const city=String(input.city??'').trim()
    const postalCodes=Array.isArray(input.postalCodes)?[...new Set(input.postalCodes.map((value:any)=>String(value).trim()))]:[]
    if(name.length<2||name.length>160||address.length<5||address.length>500||city.length<2||city.length>100||!postalCodes.length||postalCodes.some((code:string)=>!/^\d{4,10}$/.test(code)))apiError(400,'INVALID_PHARMACY','Nama, alamat, kota, dan kode pos layanan harus valid.')
    const saved=await transaction(async(client)=>{
      const r=await client.query(`INSERT INTO pharmacies(name,address_text,city,postal_codes,license_reference,status)
        VALUES($1,$2,$3,$4,$5,'pending') RETURNING id,name,status`,[name,address,city,postalCodes,String(input.licenseReference??'').trim().slice(0,160)||null])
      await audit(client,currentUser.id,'pharmacy.created','pharmacy',r.rows[0].id,{})
      return r.rows[0]
    })
    return json(saved,201)
  }
  const adminPharmacy=path.match(/^\/admin\/pharmacies\/([0-9a-f-]+)$/i)
  if(adminPharmacy&&method==='PATCH'){
    requireRole(currentUser,'admin')
    const input=await body<any>(request)
    if(!['pending','active','suspended'].includes(input.status)) apiError(400,'INVALID_STATUS','Status apotek tidak valid.')
    const saved=await transaction(async(client)=>{
      if(input.status==='active'){
        const readiness=await client.query(`SELECT p.license_reference,cardinality(p.postal_codes) AS postal_count,
          COUNT(DISTINCT i.product_id) AS inventory_count,COUNT(DISTINCT h.weekday) AS service_days
          FROM pharmacies p LEFT JOIN inventory i ON i.pharmacy_id=p.id LEFT JOIN pharmacy_service_hours h ON h.pharmacy_id=p.id AND h.service_type='prescription' AND h.active=true
          WHERE p.id=$1 GROUP BY p.id`,[adminPharmacy[1]])
        if(!readiness.rowCount)apiError(404,'NOT_FOUND','Apotek tidak ditemukan.')
        const gate=readiness.rows[0]
        if(!String(gate.license_reference??'').trim()||Number(gate.postal_count)<1||Number(gate.inventory_count)<1||Number(gate.service_days)<1)apiError(422,'PHARMACY_ONBOARDING_INCOMPLETE','Lengkapi referensi izin, wilayah layanan, alokasi stok daring, dan jam pemeriksaan resep sebelum aktivasi.')
      }
      const r=await client.query('UPDATE pharmacies SET status=$2 WHERE id=$1 RETURNING id,name,status',[adminPharmacy[1],input.status])
      if(!r.rowCount) apiError(404,'NOT_FOUND','Apotek tidak ditemukan.')
      await audit(client,currentUser.id,'pharmacy.status_changed','pharmacy',adminPharmacy[1],{status:input.status})
      return r.rows[0]
    })
    return json(saved)
  }

  if(path==='/pharmacy/inventory'&&method==='GET'){
    requireRole(currentUser,'admin','pharmacist','pharmacy_staff')
    const pharmacyIds=currentUser.roles.filter((r)=>r.pharmacyId&&['pharmacist','pharmacy_staff'].includes(r.role)).map((r)=>r.pharmacyId)
    const r=await pool.query(`SELECT i.pharmacy_id,p.id product_id,p.sku,p.name,p.sell_unit,p.requires_prescription,i.on_hand,i.reserved,i.unit_price,i.sales_blocked
      FROM inventory i JOIN products p ON p.id=i.product_id WHERE ($1::uuid[] IS NULL OR i.pharmacy_id=ANY($1::uuid[])) ORDER BY p.name`,[hasRole(currentUser,'admin')?null:pharmacyIds])
    return json({items:r.rows.map((i:any)=>({pharmacyId:i.pharmacy_id,productId:i.product_id,sku:i.sku,name:i.name,sellUnit:i.sell_unit,requiresPrescription:i.requires_prescription,onHand:i.on_hand,reserved:i.reserved,available:Number(i.on_hand)-Number(i.reserved),unitPrice:amount(i.unit_price),salesBlocked:i.sales_blocked}))})
  }
  if(path==='/pharmacy/inventory-adjustments'&&method==='POST'){
    requireRole(currentUser,'admin','pharmacist','pharmacy_staff')
    const input=await body<any>(request)
    if(!validUuid(String(input.pharmacyId))||!validUuid(String(input.productId))||!Number.isInteger(Number(input.delta))||!String(input.reason??'').trim()) apiError(400,'INVALID_ADJUSTMENT','Produk, jumlah perubahan, dan alasan diperlukan.')
    pharmacyScope(currentUser,input.pharmacyId)
    const result=await transaction(async(client)=>{
      const row=await client.query('SELECT * FROM inventory WHERE pharmacy_id=$1 AND product_id=$2 FOR UPDATE',[input.pharmacyId,input.productId])
      if(!row.rowCount) apiError(404,'NOT_FOUND','Alokasi produk tidak ditemukan.')
      const next=Number(row.rows[0].on_hand)+Number(input.delta)
      if(next<Number(row.rows[0].reserved)) apiError(409,'RESERVATION_CONFLICT','Stok tidak dapat dikurangi di bawah jumlah yang sudah direservasi.')
      await client.query('UPDATE inventory SET on_hand=$3,sales_blocked=false,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',[input.pharmacyId,input.productId,next])
      await client.query('INSERT INTO inventory_movements(pharmacy_id,product_id,delta_on_hand,reason,actor_id) VALUES($1,$2,$3,$4,$5)',[input.pharmacyId,input.productId,input.delta,String(input.reason).slice(0,500),currentUser.id])
      await audit(client,currentUser.id,'inventory.adjusted','product',input.productId,{delta:input.delta,pharmacyId:input.pharmacyId})
      return {onHand:next,reserved:Number(row.rows[0].reserved)}
    })
    return json(result)
  }
  const hoursMatch=path.match(/^\/pharmacies\/([0-9a-f-]+)\/service-hours$/i)
  if(hoursMatch&&method==='PATCH'){
    requireRole(currentUser,'admin','pharmacist')
    pharmacyScope(currentUser,hoursMatch[1])
    const input=await body<any>(request)
    if(!Array.isArray(input.hours)) apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
    const weekdays = new Set<number>()
    for(const item of input.hours){
      if(!item||typeof item!=='object')apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
      const timezone=item.timezone??'Asia/Jakarta'
      if(!Number.isInteger(item.weekday)||item.weekday<0||item.weekday>6||weekdays.has(item.weekday)||!validClock(item.opensAt)||!validClock(item.closesAt)||item.closesAt<=item.opensAt||!validTimezone(timezone)) apiError(400,'INVALID_HOURS','Jadwal layanan tidak valid.')
      weekdays.add(item.weekday)
    }
    const exceptions=Array.isArray(input.exceptions)?input.exceptions:[]
    for(const item of exceptions){
      if(!item||typeof item!=='object')apiError(400,'INVALID_HOURS','Pengecualian jam layanan tidak valid.')
      if(!validLocalDate(item.localDate)||typeof item.closed!=='boolean'||(!item.closed&&(!validClock(item.opensAt)||!validClock(item.closesAt)||item.closesAt<=item.opensAt)))apiError(400,'INVALID_HOURS','Pengecualian jam layanan tidak valid.')
    }
    await transaction(async(client)=>{
      await client.query("DELETE FROM pharmacy_service_hours WHERE pharmacy_id=$1 AND service_type='prescription'",[hoursMatch[1]])
      for(const item of input.hours) await client.query(`INSERT INTO pharmacy_service_hours(pharmacy_id,service_type,weekday,opens_at,closes_at,timezone,active)
        VALUES($1,'prescription',$2,$3,$4,$5,$6)`,[hoursMatch[1],item.weekday,item.opensAt,item.closesAt,item.timezone??'Asia/Jakarta',item.active!==false])
      for(const item of exceptions) await client.query(`INSERT INTO pharmacy_service_exceptions(pharmacy_id,service_type,local_date,closed,opens_at,closes_at,reason)
        VALUES($1,'prescription',$2,$3,$4,$5,$6) ON CONFLICT(pharmacy_id,service_type,local_date) DO UPDATE SET closed=EXCLUDED.closed,opens_at=EXCLUDED.opens_at,closes_at=EXCLUDED.closes_at,reason=EXCLUDED.reason`,[hoursMatch[1],item.localDate,item.closed,item.closed?null:item.opensAt,item.closed?null:item.closesAt,String(item.reason??'').slice(0,200)||null])
      await audit(client,currentUser.id,'pharmacy.service_hours_changed','pharmacy',hoursMatch[1],{})
    })
    return json({updated:true})
  }

  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.', requestId } }), { status: 404, headers: { 'content-type':'application/json; charset=utf-8' } })
}

async function expireUnpaidOrders(){
  await transaction(async(client)=>{
    const candidates=await client.query(`SELECT id,status FROM orders WHERE status IN ('awaiting_prescription','awaiting_payment') AND expires_at<=now()
      ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED`)
    for(const order of candidates.rows){
      const changed=await client.query("UPDATE orders SET status='expired',updated_at=now() WHERE id=$1 AND status IN ('awaiting_prescription','awaiting_payment') RETURNING id,status",[order.id])
      if(!changed.rowCount)continue
      const reservations=await client.query("SELECT * FROM stock_reservations WHERE order_id=$1 AND status='active' FOR UPDATE",[order.id])
      for(const reservation of reservations.rows){
        await client.query("UPDATE stock_reservations SET status='expired' WHERE id=$1",[reservation.id])
        await client.query('UPDATE inventory SET reserved=reserved-$3,updated_at=now() WHERE pharmacy_id=$1 AND product_id=$2',[reservation.pharmacy_id,reservation.product_id,reservation.quantity])
      }
      await addHistory(client,order.id,order.status,'expired',null,'Masa reservasi berakhir')
      await client.query("INSERT INTO outbox_events(event_type,aggregate_id,payload) VALUES('order.expired',$1,$2)",[order.id,{orderId:order.id}])
    }
  })
}

const server = Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  async fetch(request) {
    const requestId = randomUUID()
    const origin = request.headers.get('origin')
    if (origin && origin !== WEB_ORIGIN) return new Response('Origin tidak diizinkan.', { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-origin':WEB_ORIGIN,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'content-type,x-csrf-token,idempotency-key'}})
    if (!new URL(request.url).pathname.startsWith(API+'/')) return new Response('Not found',{status:404})
    try {
      const contentLength = Number(request.headers.get('content-length') ?? 0)
      if (contentLength > MAX_REQUEST_BODY_BYTES) apiError(413,'REQUEST_TOO_LARGE','Ukuran permintaan melebihi batas yang diizinkan.')
      const user = await userForRequest(request)
      const path = new URL(request.url).pathname.slice(API.length)
      const publicWrite = ['/auth/register','/auth/login','/auth/contact-verification','/auth/password-reset'].includes(path)
      if (user && !['GET','HEAD','OPTIONS'].includes(request.method) && !publicWrite && request.headers.get('x-csrf-token') !== user.csrfToken) apiError(403,'CSRF_INVALID','Sesi tidak valid. Muat ulang halaman dan coba lagi.')
      const response = await route(request,user,requestId)
      response.headers.set('x-request-id',requestId)
      if (origin === WEB_ORIGIN) {
        response.headers.set('access-control-allow-origin',WEB_ORIGIN)
        response.headers.set('access-control-allow-credentials','true')
        response.headers.append('vary','Origin')
      }
      return response
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string }
      const api = error instanceof ApiError ? error : databaseError?.code === '23505' && ['users_email_unique','users_phone_unique'].includes(databaseError.constraint ?? '')
        ? new ApiError(409,'CONTACT_IN_USE','Email atau nomor telepon sudah terdaftar.')
        : databaseError?.code === '23505'
          ? new ApiError(409,'RESOURCE_CONFLICT','Permintaan ini bertentangan dengan data yang sudah ada.')
          : new ApiError(500,'INTERNAL_ERROR','Terjadi gangguan. Coba lagi atau hubungi bantuan.')
      if (!(error instanceof ApiError)) console.error(JSON.stringify({requestId, error: error instanceof Error ? error.message : 'unknown'}))
      const response = errorJson(api,requestId)
      if (origin === WEB_ORIGIN) {
        response.headers.set('access-control-allow-origin',WEB_ORIGIN)
        response.headers.set('access-control-allow-credentials','true')
      }
      return response
    }
  },
})

console.info(`API Apotek Digital berjalan di http://localhost:${server.port}`)
const expirationTimer=setInterval(()=>{void expireUnpaidOrders().catch(()=>console.error('Pekerjaan kedaluwarsa reservasi gagal; akan dicoba kembali.'))},15_000)
expirationTimer.unref?.()
