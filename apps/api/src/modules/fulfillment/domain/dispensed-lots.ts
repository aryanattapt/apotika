export type DispensedLot = { lotNumber: string; expiresOn: string; quantity: number }
export type LotParseResult = { ok: true; lots: DispensedLot[] } | { ok: false; reason: 'required' | 'invalid' | 'quantity-mismatch' }

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
}

export function parseDispensedLots(input: unknown, expectedQuantity: number): LotParseResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, reason: 'required' }
  const lots: DispensedLot[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'invalid' }
    const value = entry as Record<string, unknown>
    const lotNumber = String(value.lotNumber ?? '').trim()
    const expiresOn = String(value.expiresOn ?? '').trim()
    const quantity = Number(value.quantity)
    if (!lotNumber || lotNumber.length > 120 || !validDate(expiresOn) || !Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, reason: 'invalid' }
    }
    lots.push({ lotNumber, expiresOn, quantity })
  }
  if (lots.reduce((sum, lot) => sum + lot.quantity, 0) !== expectedQuantity) return { ok: false, reason: 'quantity-mismatch' }
  return { ok: true, lots }
}
