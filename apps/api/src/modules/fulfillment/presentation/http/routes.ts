import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import type { FulfillmentCheckRequestDto, FulfillmentCommandRequestDto } from './dto'
import { requestShipmentBooking, runFulfillmentCommand, saveFulfillmentCheck } from '../../public'

const { body, json, limit, requireRole } = shared

export async function handleFulfillmentRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  const fulfillmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment$/i)
  if (fulfillmentMatch && method === 'POST') {
    requireRole(currentUser, 'pharmacist', 'pharmacy_staff')
    limit(request, 'fulfillment-write', 6_000)
    const input = await body<FulfillmentCommandRequestDto>(request)
    if (input.command === 'confirm_pickup') {
      limit(request, 'pickup-confirm-actor', 60, currentUser.id)
      limit(request, 'pickup-confirm-order', 5, currentUser.id + ':' + fulfillmentMatch[1])
    }
    return json(await runFulfillmentCommand(fulfillmentMatch[1], currentUser, input))
  }
  const checkMatch = path.match(/^\/orders\/([0-9a-f-]+)\/fulfillment-checks$/i)
  if (checkMatch && method === 'POST') {
    requireRole(currentUser, 'pharmacist', 'pharmacy_staff')
    limit(request, 'fulfillment-write', 6_000)
    const input = await body<FulfillmentCheckRequestDto>(request)
    return json(await saveFulfillmentCheck(checkMatch[1], currentUser, input), 201)
  }
  const shipmentMatch = path.match(/^\/orders\/([0-9a-f-]+)\/shipment-bookings$/i)
  if (shipmentMatch && method === 'POST') {
    requireRole(currentUser, 'pharmacist', 'pharmacy_staff')
    limit(request, 'fulfillment-write', 6_000)
    await requestShipmentBooking(shipmentMatch[1], currentUser)
  }

  return null
}
