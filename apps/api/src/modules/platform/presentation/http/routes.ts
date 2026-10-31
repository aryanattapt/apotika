import * as shared from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
const { json } = shared

export async function handleSystemRoute({ request, url, path, method, requestId, user }: PublicRouteContext): Promise<Response | null> {
  if (path === '/health' && method === 'GET') {
    const result = await pool.query('SELECT 1 AS ok')
    return json({ status: 'ok', database: result.rowCount === 1 })
  }

  return null
}
