import { cents } from '../../../shared/domain/money'

export type RefundCapacity = {
  receivedAmount: string | number | null
  alreadyRequestedAmount: string | number
  requestedAmount: string | number
}

/** Refunds cannot exceed settled funds, including requests already in progress. */
export function canRequestRefund({
  receivedAmount,
  alreadyRequestedAmount,
  requestedAmount,
}: RefundCapacity): boolean {
  if (receivedAmount === null) return false
  const requested = cents(requestedAmount)
  return (
    Number.isFinite(requested) &&
    requested > 0 &&
    cents(alreadyRequestedAmount) + requested <= cents(receivedAmount)
  )
}
