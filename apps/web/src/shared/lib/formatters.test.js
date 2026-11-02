import { describe, expect, test } from 'bun:test'
import { money, statusLabel } from './formatters.js'

describe('web formatters', () => {
  test('formats Rupiah amounts using Indonesian separators without decimals', () => {
    expect(money(28500)).toContain('28.500')
    expect(money('28500')).toContain('28.500')
    expect(money(28500.8)).toContain('28.501')
    expect(money(0)).toContain('0')
    expect(money(null)).toContain('0')
  })

  test('provides a readable label for every supported order status', () => {
    expect(statusLabel).toEqual({
      awaiting_prescription: 'Menunggu resep',
      awaiting_payment: 'Menunggu pembayaran',
      paid: 'Dibayar',
      processing: 'Disiapkan',
      ready: 'Siap diambil',
      in_delivery: 'Dalam pengiriman',
      completed: 'Selesai',
      cancelled: 'Dibatalkan',
      expired: 'Kedaluwarsa',
    })
    expect(statusLabel.unknown_status).toBeUndefined()
  })
})
