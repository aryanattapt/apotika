import { describe, expect, test } from 'bun:test'
import { generatePickupCode, normalizePickupCode } from './pickup-code'

describe('pickup codes', () => {
  test('generates a 12-character hexadecimal code with 48 bits of random input', () => {
    for (let index = 0; index < 100; index++) {
      const code = generatePickupCode()
      expect(code).toMatch(/^[0-9A-F]{12}$/)
      expect(normalizePickupCode(code)).toBe(code)
    }
  })

  test('normalizes case and surrounding whitespace before comparison', () => {
    expect(normalizePickupCode('  ab12cd34ef56  ')).toBe('AB12CD34EF56')
  })

  test('rejects malformed, short, long, and non-string codes', () => {
    for (const code of ['ABCDE', 'ABCDEFGHIJKL3', 'GGGGGGGGGGGG', '', null, 123456789012]) {
      expect(normalizePickupCode(code)).toBeNull()
    }
  })
})
