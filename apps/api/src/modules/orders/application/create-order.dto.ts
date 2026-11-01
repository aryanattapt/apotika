export type CreateOrderRequestDto = {
  quoteId?: string
}

export type CreateOrderDto = {
  quoteId: string
  customerId: string
  idempotencyKey: string
}
