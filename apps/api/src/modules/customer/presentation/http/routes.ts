import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import { createCustomerAddress, listCustomerAddresses, updateCustomerAddress } from '../../public'
import type { AddressInputDto } from '../../application/address.dto'
const { body, json } = shared

export async function handleCustomerRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  if (path === '/addresses' && method === 'GET') {
    const items = await listCustomerAddresses(currentUser.id)
    return json({ items })
  }

  if (path === '/addresses' && method === 'POST') {
    const input = await body<Partial<AddressInputDto>>(request)
    const saved = await createCustomerAddress(currentUser.id, input)
    return json(saved, 201)
  }

  const addressMatch = path.match(/^\/addresses\/([0-9a-f-]+)$/i)
  if (addressMatch && method === 'PATCH') {
    const input = await body<Partial<AddressInputDto>>(request)
    await updateCustomerAddress(currentUser.id, addressMatch[1], input)
    return json({ id: addressMatch[1] })
  }

  return null
}
