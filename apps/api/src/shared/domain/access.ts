export type Role = { role: string; pharmacyId: string | null }
export type User = {
  id: string
  name: string
  email: string | null
  phone: string | null
  email_verified_at: string | null
  phone_verified_at: string | null
  roles: Role[]
  csrfToken: string
}

export function hasRole(user: User, ...roles: string[]) {
  return user.roles.some((entry) => roles.includes(entry.role))
}

export function canAccessPharmacy(user: User, pharmacyId: string) {
  return user.roles.some(
    (entry) =>
      ['admin', 'pharmacist', 'pharmacy_staff'].includes(entry.role) &&
      (entry.role === 'admin' || entry.pharmacyId === pharmacyId),
  )
}

export function hasVerifiedContact(user: User) {
  return Boolean((user.email && user.email_verified_at) || (user.phone && user.phone_verified_at))
}
