import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import {
  configureAdminInventoryRecord,
  createAdminPharmacyRecord,
  createAdminProductRecord,
  getAdminCancellationRequests,
  getAdminOrders,
  getAdminPharmacies,
  getAdminProducts,
  getAdminSupportCases,
  updateAdminPharmacyRecord,
  updateAdminProductRecord,
} from '../../public'
import type {
  ConfigureInventoryRequestDto,
  CreatePharmacyRequestDto,
  CreateProductRequestDto,
  UpdatePharmacyRequestDto,
  UpdateProductRequestDto,
} from './dto'
const { body, json, requireRole } = shared

export async function handleAdminRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/admin/products' && method === 'GET') {
    requireRole(currentUser, 'admin', 'pharmacist')
    return json({ items: await getAdminProducts() })
  }
  if (path === '/admin/pharmacies' && method === 'GET') {
    requireRole(currentUser, 'admin', 'cs')
    return json({ items: await getAdminPharmacies() })
  }
  if (path === '/admin/orders' && method === 'GET') {
    requireRole(currentUser, 'admin', 'cs')
    return json({ items: await getAdminOrders() })
  }
  if (path === '/admin/cancellation-requests' && method === 'GET') {
    requireRole(currentUser, 'admin', 'cs')
    return json({ items: await getAdminCancellationRequests() })
  }
  if (path === '/admin/support-cases' && method === 'GET') {
    requireRole(currentUser, 'admin', 'cs', 'finance')
    return json({ items: await getAdminSupportCases() })
  }
  if (path === '/admin/products' && method === 'POST') {
    requireRole(currentUser, 'pharmacist')
    const input = await body<CreateProductRequestDto>(request)
    const saved = await createAdminProductRecord(currentUser.id, input)
    return json(saved, 201)
  }
  if (path === '/admin/inventory' && method === 'POST') {
    requireRole(currentUser, 'admin')
    const input = await body<ConfigureInventoryRequestDto>(request)
    const result = await configureAdminInventoryRecord(currentUser.id, input)
    return json(result)
  }
  const adminProduct = path.match(/^\/admin\/products\/([0-9a-f-]+)$/i)
  if (adminProduct && method === 'PATCH') {
    requireRole(currentUser, 'pharmacist')
    const input = await body<UpdateProductRequestDto>(request)
    const result = await updateAdminProductRecord(currentUser.id, adminProduct[1], input)
    return json(result)
  }
  if (path === '/admin/pharmacies' && method === 'POST') {
    requireRole(currentUser, 'admin')
    const input = await body<CreatePharmacyRequestDto>(request)
    const saved = await createAdminPharmacyRecord(currentUser.id, input)
    return json(saved, 201)
  }
  const adminPharmacy = path.match(/^\/admin\/pharmacies\/([0-9a-f-]+)$/i)
  if (adminPharmacy && method === 'PATCH') {
    requireRole(currentUser, 'admin')
    const input = await body<UpdatePharmacyRequestDto>(request)
    const result = await updateAdminPharmacyRecord(currentUser.id, adminPharmacy[1], input)
    return json(result)
  }

  return null
}
