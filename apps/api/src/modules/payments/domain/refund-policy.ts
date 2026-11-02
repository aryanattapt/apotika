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
  const received = cents(receivedAmount)
  const alreadyRequested = cents(alreadyRequestedAmount)
  const requested = cents(requestedAmount)
  return (
    Number.isFinite(received) &&
    Number.isFinite(alreadyRequested) &&
    Number.isFinite(requested) &&
    received >= 0 &&
    alreadyRequested >= 0 &&
    requested > 0 &&
    alreadyRequested + requested <= received
  )
}
