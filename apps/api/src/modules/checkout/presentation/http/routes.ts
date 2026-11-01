import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { createCheckoutQuote } from '../../public'
import type { CreateQuoteRequestDto } from './dto'

const { body, json, requireRole, verified } = shared

export async function handleCheckoutRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  if (path !== '/checkout/quote' || method !== 'POST') return null

  requireRole(currentUser, 'customer')
  verified(currentUser)
  const input = await body<CreateQuoteRequestDto>(request)
  return json(await createCheckoutQuote(currentUser.id, input))
}
