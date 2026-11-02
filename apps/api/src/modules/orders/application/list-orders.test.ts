import { describe, expect, test } from 'bun:test'
import type { User } from '../../../shared/domain/access'
import {
  listOrderViews,
  listOrderViewsForUser,
  type OrderListFilter,
  type OrderListRepository,
  type OrderListRow,
} from './list-orders'

const customer: User = {
  id: 'customer-1', name: 'Customer', email: null, phone: null,
  email_verified_at: null, phone_verified_at: null, roles: [], csrfToken: '',
}
const row: OrderListRow = {
  id: 'order-1', status: 'paid', fulfillment_method: 'pickup', total: '12.5',
  created_at: new Date('2026-11-01T00:00:00.000Z'),
  expires_at: new Date('2026-11-01T00:30:00.000Z'), pharmacy_id: 'pharmacy-1',
}
function makeRepository(rows: OrderListRow[] = [row]) {
  const filters: OrderListFilter[] = []
  const repository: OrderListRepository = {
    findList: async (filter) => { filters.push(filter); return rows },
  }
  return { repository, filters }
}

describe('order list use case', () => {
  test('scopes customer results to the signed-in customer', async () => {
    const { repository, filters } = makeRepository()
    const result = await listOrderViewsForUser(repository, customer)
    expect(filters).toEqual([{ customerId: 'customer-1' }])
    expect(result[0]).toMatchObject({ id: 'order-1', total: '12.50', fulfillmentMethod: 'pickup' })
  })

  test('scopes pharmacy staff to all assigned pharmacies only', async () => {
    const { repository, filters } = makeRepository()
    const staff: User = {
      ...customer,
      id: 'staff-1',
      roles: [
        { role: 'pharmacist', pharmacyId: 'pharmacy-1' },
        { role: 'pharmacy_staff', pharmacyId: 'pharmacy-2' },
      ],
    }
    await listOrderViewsForUser(repository, staff)
    expect(filters).toEqual([{
      customerId: 'staff-1',
      pharmacyIds: ['pharmacy-1', 'pharmacy-2'],
    }])
  })

  test('uses an unscoped filter for admin and customer support', async () => {
    for (const role of ['admin', 'cs']) {
      const { repository, filters } = makeRepository()
      await listOrderViewsForUser(repository, {
        ...customer, roles: [{ role, pharmacyId: null }],
      })
      expect(filters).toEqual([{}])
    }
  })

  test('normalizes currency while preserving the returned dates and pharmacy ID', async () => {
    const { repository } = makeRepository()
    const [view] = await listOrderViews(repository, {})
    expect(view).toEqual({
      id: row.id,
      status: row.status,
      fulfillmentMethod: 'pickup',
      total: '12.50',
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      pharmacyId: row.pharmacy_id,
    })
  })
})
