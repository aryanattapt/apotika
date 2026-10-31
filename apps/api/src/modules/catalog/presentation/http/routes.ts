import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
import { publicProduct } from '../../domain/product-view'
const { apiError, json } = shared

export async function handleCatalogRoutes({ request, url, path, method, requestId, user }: PublicRouteContext): Promise<Response | null> {
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

  return null
}
