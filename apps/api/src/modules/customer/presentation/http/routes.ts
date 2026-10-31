import * as shared from '../../../../shared/api'
import { pool } from '../../../../infrastructure/database/client'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'

const { apiError, body, json } = shared

export async function handleCustomerRoutes({ request, path, method, currentUser }: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/addresses' && method === 'GET') {
    const result = await pool.query('SELECT id,recipient_name,phone,address_text,city,postal_code,created_at FROM addresses WHERE user_id=$1 ORDER BY created_at DESC', [currentUser.id])
    return json({ items: result.rows.map((row: any) => ({ id:row.id, recipientName:row.recipient_name, phone:row.phone, addressText:row.address_text, city:row.city, postalCode:row.postal_code, createdAt:row.created_at })) })
  }

  if (path === '/addresses' && method === 'POST') {
    const input = await body<any>(request)
    const values = [String(input.recipientName ?? '').trim(), String(input.phone ?? '').trim(), String(input.addressText ?? '').trim(), String(input.city ?? '').trim(), String(input.postalCode ?? '').trim()]
    if (values.some((value) => !value) || values[0].length > 100 || values[2].length > 500) apiError(400, 'INVALID_ADDRESS', 'Lengkapi nama penerima, telepon, alamat, kota, dan kode pos.')
    const result = await pool.query(`INSERT INTO addresses(user_id,recipient_name,phone,address_text,city,postal_code)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id,recipient_name,phone,address_text,city,postal_code`, [currentUser.id, ...values])
    const address = result.rows[0]
    return json({ id:address.id, recipientName:address.recipient_name, phone:address.phone, addressText:address.address_text, city:address.city, postalCode:address.postal_code }, 201)
  }

  const addressMatch = path.match(/^\/addresses\/([0-9a-f-]+)$/i)
  if (addressMatch && method === 'PATCH') {
    const input = await body<any>(request)
    const values = [String(input.recipientName ?? '').trim(), String(input.phone ?? '').trim(), String(input.addressText ?? '').trim(), String(input.city ?? '').trim(), String(input.postalCode ?? '').trim()]
    if (values.some((value) => !value)) apiError(400, 'INVALID_ADDRESS', 'Semua kolom alamat diperlukan.')
    const result = await pool.query(`UPDATE addresses SET recipient_name=$3,phone=$4,address_text=$5,city=$6,postal_code=$7,updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING id`, [addressMatch[1], currentUser.id, ...values])
    if (!result.rowCount) apiError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.')
    return json({ id: addressMatch[1] })
  }

  return null
}
