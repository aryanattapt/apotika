import { API, apiError, json, requireUser } from '../../shared/api'
import type { User } from '../../shared/api'
import type { PublicRouteContext, AuthenticatedRouteContext } from './routes/route-context'
import { handleSystemRoute } from './routes/system.routes'
import { handleAuthRoutes } from './routes/auth.routes'
import { handleCatalogRoutes } from './routes/catalog.routes'
import { handleCustomerRoutes } from './routes/customer.routes'
import { handleOrderRoutes } from './routes/orders.routes'
import { handlePrescriptionRoutes } from './routes/prescription.routes'
import { handlePaymentRoutes } from './routes/payment.routes'
import { handleFulfillmentRoutes } from './routes/fulfillment.routes'
import { handleSupportRoutes } from './routes/support.routes'
import { handleAdminRoutes } from './routes/admin.routes'
import { handlePharmacyRoutes } from './routes/pharmacy.routes'

export async function route(request: Request, user: User | null, requestId: string): Promise<Response> {
  const url = new URL(request.url)
  const context: PublicRouteContext = {
    request,
    user,
    requestId,
    url,
    path: url.pathname.slice(API.length) || '/',
    method: request.method.toUpperCase(),
  }

  const publicHandlers = [handleSystemRoute, handleAuthRoutes, handleCatalogRoutes]
  for (const handler of publicHandlers) {
    const response = await handler(context)
    if (response) return response
  }

  const currentUser = requireUser(user)
  const authenticatedContext: AuthenticatedRouteContext = { ...context, user: currentUser, currentUser }
  const authenticatedHandlers = [
    handleCustomerRoutes,
    handleOrderRoutes,
    handlePrescriptionRoutes,
    handlePaymentRoutes,
    handleFulfillmentRoutes,
    handleSupportRoutes,
    handleAdminRoutes,
    handlePharmacyRoutes,
  ]
  for (const handler of authenticatedHandlers) {
    const response = await handler(authenticatedContext)
    if (response) return response
  }

  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.', requestId } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}
