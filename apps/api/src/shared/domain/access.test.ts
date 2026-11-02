import { describe, expect, test } from 'bun:test'
import { canAccessPharmacy, hasRole, hasVerifiedContact, type User } from './access'

const user: User = {
  id: 'user-1', name: 'Arya', email: 'arya@example.test', phone: '0812',
  email_verified_at: null, phone_verified_at: null, roles: [], csrfToken: '',
}

describe('identity access rules', () => {
  test('matches one of the requested roles', () => {
    const staff = { ...user, roles: [{ role: 'pharmacy_staff', pharmacyId: 'p1' }] }
    expect(hasRole(staff, 'admin', 'pharmacy_staff')).toBe(true)
    expect(hasRole(staff, 'admin', 'cs')).toBe(false)
  })

  test('grants pharmacy access to admins and the specifically assigned pharmacy', () => {
    expect(canAccessPharmacy({ ...user, roles: [{ role: 'admin', pharmacyId: null }] }, 'any')).toBe(true)
    expect(canAccessPharmacy({ ...user, roles: [{ role: 'pharmacist', pharmacyId: 'p1' }] }, 'p1')).toBe(true)
    expect(canAccessPharmacy({ ...user, roles: [{ role: 'pharmacy_staff', pharmacyId: 'p1' }] }, 'p2')).toBe(false)
    expect(canAccessPharmacy({ ...user, roles: [{ role: 'cs', pharmacyId: null }] }, 'p1')).toBe(false)
  })

  test('requires a verified address for an existing contact method', () => {
    expect(hasVerifiedContact(user)).toBe(false)
    expect(hasVerifiedContact({ ...user, email_verified_at: '2026-11-01T00:00:00Z' })).toBe(true)
    expect(hasVerifiedContact({ ...user, phone_verified_at: '2026-11-01T00:00:00Z' })).toBe(true)
    expect(hasVerifiedContact({ ...user, email: null, email_verified_at: '2026-11-01T00:00:00Z' })).toBe(false)
  })
})
