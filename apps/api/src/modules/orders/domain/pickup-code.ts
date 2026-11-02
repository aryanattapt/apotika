import { randomBytes } from 'node:crypto'

export function generatePickupCode() {
  return randomBytes(6).toString('hex').toUpperCase()
}

export function normalizePickupCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[0-9A-F]{12}$/.test(code) ? code : null
}
