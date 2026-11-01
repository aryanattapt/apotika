import { describe, expect, test } from 'bun:test'
import {
  isValidServiceExceptions,
  isValidServiceHours,
  isWithinServiceHours,
  localServiceTime,
  validLocalDate,
} from './service-hours'

describe('pharmacy schedule domain', () => {
  test('validates local dates including leap days', () => {
    expect(validLocalDate('2024-02-29')).toBe(true)
    expect(validLocalDate('2025-02-29')).toBe(false)
    expect(validLocalDate('2026-13-01')).toBe(false)
  })

  test('converts an instant using the pharmacy timezone', () => {
    expect(localServiceTime('Asia/Jakarta', new Date('2026-10-31T02:30:00.000Z'))).toEqual({
      weekday: 6,
      minute: 570,
      date: '2026-10-31',
    })
    expect(localServiceTime('invalid/time', new Date('2026-10-31T02:30:00.000Z'))).toBeNull()
  })

  test('uses a half-open service interval and rejects duplicate weekdays', () => {
    const hours = { weekday: 6, opensAt: '09:00', closesAt: '10:00', timezone: 'Asia/Jakarta' }
    expect(isWithinServiceHours(hours, new Date('2026-10-31T02:30:00.000Z'))).toBe(true)
    expect(isWithinServiceHours(hours, new Date('2026-10-31T03:00:00.000Z'))).toBe(false)
    expect(isValidServiceHours([hours])).toBe(true)
    expect(isValidServiceHours([hours, hours])).toBe(false)
    expect(isValidServiceExceptions([{ localDate: '2026-11-01', closed: true }])).toBe(true)
    expect(
      isValidServiceExceptions([
        { localDate: '2026-11-01', closed: false, opensAt: '18:00', closesAt: '09:00' },
      ]),
    ).toBe(false)
  })
})
