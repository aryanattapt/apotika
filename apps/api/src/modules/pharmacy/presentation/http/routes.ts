import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { adjustInventory, getPharmacyInventory, updatePharmacyServiceHours } from '../../public'
import type {
  InventoryAdjustmentDto,
  ReplaceServiceHoursRequestDto,
} from '../../application/pharmacy.dto'
const { body, json, requireRole } = shared

export async function handlePharmacyRoutes({
  request,
  url,
  path,
  method,
  requestId,
  user,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/pharmacy/inventory' && method === 'GET') {
    requireRole(currentUser, 'admin', 'pharmacist', 'pharmacy_staff')
    return json({ items: await getPharmacyInventory(currentUser) })
  }
  if (path === '/pharmacy/inventory-adjustments' && method === 'POST') {
    requireRole(currentUser, 'admin', 'pharmacist', 'pharmacy_staff')
    const input = await body<Partial<InventoryAdjustmentDto>>(request)
    return json(await adjustInventory(currentUser, input))
  }
  const hoursMatch = path.match(/^\/pharmacies\/([0-9a-f-]+)\/service-hours$/i)
  if (hoursMatch && method === 'PATCH') {
    requireRole(currentUser, 'admin', 'pharmacist')
    const input = await body<ReplaceServiceHoursRequestDto>(request)
    await updatePharmacyServiceHours(hoursMatch[1], currentUser, input)
    return json({ updated: true })
  }

  return null
}
