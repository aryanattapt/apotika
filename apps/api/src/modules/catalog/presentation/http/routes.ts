import * as shared from '../../../../shared/api'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
import { getPublicProduct, listPublicProducts } from '../../public'
const { apiError, json } = shared

export async function handleCatalogRoutes({
  request,
  url,
  path,
  method,
  requestId,
  user,
}: PublicRouteContext): Promise<Response | null> {
  if (path === '/products' && method === 'GET') {
    return json(
      await listPublicProducts(url.searchParams.get('query'), url.searchParams.get('category')),
    )
  }
  const publicProductMatch = path.match(/^\/products\/([0-9a-f-]+)$/i)
  if (publicProductMatch && method === 'GET') {
    return json(await getPublicProduct(publicProductMatch[1]))
  }
  if (/^\/webhooks\/(payment|shipping)\/[a-z0-9_-]+$/i.test(path) && method === 'POST') {
    apiError(503, 'PROVIDER_NOT_CONFIGURED', 'Adapter penyedia belum dikonfigurasi.')
  }

  return null
}
