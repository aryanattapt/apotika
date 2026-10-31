import type { User } from '../../shared/domain/access'
import { getOrderView as executeGetOrderView } from './application/get-order'
import { PostgresOrderReadRepository, type Queryable } from './infrastructure/order-read.repository'
export { insertOrderStatusHistory } from './infrastructure/order-history.repository'

/** Public read facade for other modules and the HTTP adapter. */
export function getOrderView(client: Queryable, orderId: string, user: User) {
  return executeGetOrderView(new PostgresOrderReadRepository(client), orderId, user)
}
