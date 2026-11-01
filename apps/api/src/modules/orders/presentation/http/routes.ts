import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { createOrderForCustomer, getOrderView, listOrderViewsForUser } from '../../public'
import type { CreateOrderRequestDto } from './dto'

const { body, json, requireRole, verified } = shared

export async function handleOrderRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/orders' && method === 'POST') {
    requireRole(currentUser, 'customer')
    verified(currentUser)
    const input = await body<CreateOrderRequestDto>(request)
    const order = await createOrderForCustomer(
      currentUser.id,
      input,
      request.headers.get('idempotency-key'),
    )
    return json(order, 201)
  }

  if (path === '/orders' && method === 'GET')
    return json({ items: await listOrderViewsForUser(currentUser) })

  const orderGet = path.match(/^\/orders\/([0-9a-f-]+)$/i)
  if (orderGet && method === 'GET') return json(await getOrderView(orderGet[1], currentUser))

  return null
}
