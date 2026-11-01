const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CartItem = { productId: string; quantity: number }
export type CartParseResult =
  | { ok: true; items: CartItem[] }
  | { ok: false; reason: 'INVALID_LENGTH' | 'INVALID_ITEM' | 'DUPLICATE_PRODUCT' }

/** Normalize untrusted checkout input before the application layer reads product data. */
export function parseCartItems(input: unknown): CartParseResult {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30)
    return { ok: false, reason: 'INVALID_LENGTH' }

  const byId = new Map<string, number>()
  for (const row of input) {
    if (!row || typeof row !== 'object') return { ok: false, reason: 'INVALID_ITEM' }
    const candidate = row as Record<string, unknown>
    const productId = String(candidate.productId ?? '')
    const quantity = Number(candidate.quantity)
    if (!UUID.test(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      return { ok: false, reason: 'INVALID_ITEM' }
    if (byId.has(productId)) return { ok: false, reason: 'DUPLICATE_PRODUCT' }
    byId.set(productId, quantity)
  }

  return {
    ok: true,
    items: [...byId]
      .map(([productId, quantity]) => ({ productId, quantity }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
  }
}
