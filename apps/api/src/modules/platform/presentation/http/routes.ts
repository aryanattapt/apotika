import * as shared from '../../../../shared/api'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
import { getPlatformHealth } from '../../public'
const { json } = shared

export async function handleSystemRoute({
  request,
  url,
  path,
  method,
  requestId,
  user,
}: PublicRouteContext): Promise<Response | null> {
  if (path === '/health' && method === 'GET') {
    return json(await getPlatformHealth())
  }

  return null
}
