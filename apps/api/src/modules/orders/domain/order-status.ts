export const ORDER_STATUSES = [
  'awaiting_prescription',
  'awaiting_payment',
  'paid',
  'processing',
  'ready',
  'completed',
  'cancelled',
  'expired',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_prescription: ['awaiting_payment', 'cancelled', 'expired'],
  awaiting_payment: ['paid', 'cancelled', 'expired'],
  paid: ['processing', 'cancelled'],
  processing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
}

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}

export function canTransitionOrder(from: string, to: string): boolean {
  return isOrderStatus(from) && isOrderStatus(to) && TRANSITIONS[from].includes(to)
}
