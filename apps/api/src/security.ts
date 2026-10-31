import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function encryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? ''
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY harus berupa 32 byte (64 karakter hex atau base64).')
  return key
}

export function createTotpSecret() {
  const bytes = randomBytes(20)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let encoded = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31]
  return encoded
}

function decodeBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let accumulator = 0
  const bytes: number[] = []
  for (const char of value.toUpperCase().replace(/=+$/g, '')) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error('Invalid TOTP secret')
    accumulator = (accumulator << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

export function encryptMfaSecret(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptMfaSecret(value: string) {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted TOTP secret')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function tokenFor(secret: string, counter: number) {
  const value = Buffer.alloc(8)
  value.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(value).digest()
  const offset = digest[digest.length - 1] & 15
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(number).padStart(6, '0')
}

export function verifyTotp(secret: string, value: string) {
  if (!/^\d{6}$/.test(value)) return false
  const current = Math.floor(Date.now() / 30_000)
  const supplied = Buffer.from(value)
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(tokenFor(secret, current + offset))
    if (timingSafeEqual(supplied, expected)) return true
  }
  return false
}
