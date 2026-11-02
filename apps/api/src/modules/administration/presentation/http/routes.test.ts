import { describe, expect, test } from 'bun:test'
import { ApiError } from '../../../../shared/api'
import type { User } from '../../../../shared/domain/access'

process.env.DATABASE_URL ??= 'postgres://farmago:test@127.0.0.1:5432/farmago_test'
const { handleAdminRoutes } = await import('./routes')

const pharmacist: User = {
  id: 'pharmacist-1',
  name: 'Apoteker',
  email: 'pharmacist@example.test',
  phone: null,
  email_verified_at: null,
  phone_verified_at: null,
  roles: [{ role: 'pharmacist', pharmacyId: 'pharmacy-1' }],
  csrfToken: 'csrf',
}

async function invokeMutation(path: string, method: 'POST' | 'PATCH') {
  const url = new URL('http://localhost' + path)
  return handleAdminRoutes({
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    url,
    path,
    method,
    requestId: 'test-request',
    user: pharmacist,
    currentUser: pharmacist,
  })
}

describe('admin product routes', () => {
  test('rejects pharmacy-scoped pharmacists from creating or editing the global catalog', async () => {
    for (const [path, method] of [
      ['/admin/products', 'POST'],
      ['/admin/products/00000000-0000-4000-8000-000000000001', 'PATCH'],
    ] as const) {
      const error = await invokeMutation(path, method).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    }
  })
})
