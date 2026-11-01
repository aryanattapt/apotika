import { amount } from '../../../shared/domain/money'
import { hasRole, type User } from '../../../shared/domain/access'

export type OrderListFilter = {
  customerId?: string
  pharmacyIds?: string[]
}

export type OrderListRow = {
  id: string
  status: string
  fulfillment_method: string
  total: string
  created_at: Date
  expires_at: Date
  pharmacy_id: string
}

export interface OrderListRepository {
  findList(filter: OrderListFilter): Promise<OrderListRow[]>
}

export async function listOrderViews(repository: OrderListRepository, filter: OrderListFilter) {
  const items = await repository.findList(filter)
  return items.map((order) => ({
    id: order.id,
    status: order.status,
    fulfillmentMethod: order.fulfillment_method,
    total: amount(order.total),
    createdAt: order.created_at,
    expiresAt: order.expires_at,
    pharmacyId: order.pharmacy_id,
  }))
}

export function listOrderViewsForUser(repository: OrderListRepository, user: User) {
  if (user.roles.some((role) => role.role === 'pharmacist' || role.role === 'pharmacy_staff')) {
    const pharmacyIds = user.roles
      .filter((role) => role.pharmacyId && ['pharmacist', 'pharmacy_staff'].includes(role.role))
      .map((role) => role.pharmacyId!)
    return listOrderViews(repository, { customerId: user.id, pharmacyIds })
  }
  if (hasRole(user, 'admin', 'cs')) return listOrderViews(repository, {})
  return listOrderViews(repository, { customerId: user.id })
}
