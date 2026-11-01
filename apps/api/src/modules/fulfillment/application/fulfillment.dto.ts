export type FulfillmentCommandRequestDto = {
  command?: string
  proofReference?: string
  pickupCode?: string
}

export type FulfillmentItemRequestDto = {
  orderItemId?: string
  quantity?: number | string
  lots?: unknown
}

export type FulfillmentCheckRequestDto = {
  items?: unknown
  passed?: boolean
  pharmacistCheck?: boolean
  note?: string
}
