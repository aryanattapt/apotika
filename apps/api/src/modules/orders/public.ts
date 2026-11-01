import type { User } from '../../shared/domain/access'
import { listOrderViewsForUser as executeListOrderViewsForUser } from './application/list-orders'
import { submitOrder as submitOrderRequest } from './application/create-order'
import type { CreateOrderRequestDto } from './application/create-order.dto'
import { getOrderView as executeGetOrderView } from './application/get-order'
import {
  listOrderViews as executeListOrderViews,
  type OrderListFilter,
} from './application/list-orders'
import { PostgresOrderReadRepository } from './infrastructure/order-read.repository'
import { PostgresOrderWriteRepository } from './infrastructure/order-write.repository'

export { insertOrderStatusHistory } from './infrastructure/order-history.repository'

export function getOrderView(orderId: string, user: User) {
  return executeGetOrderView(new PostgresOrderReadRepository(), orderId, user)
}

export function listOrderViews(filter: OrderListFilter) {
  return executeListOrderViews(new PostgresOrderReadRepository(), filter)
}

export function listOrderViewsForUser(user: User) {
  return executeListOrderViewsForUser(new PostgresOrderReadRepository(), user)
}

export function createOrderForCustomer(
  customerId: string,
  input: CreateOrderRequestDto,
  idempotencyKey: string | null,
) {
  return submitOrderRequest(new PostgresOrderWriteRepository(), customerId, input, idempotencyKey)
}
