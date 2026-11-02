import { describe, expect, test } from 'bun:test'
import {
  OrderWriteError,
  createOrder,
  submitOrder,
  type OrderWriteRepository,
} from './create-order'

const QUOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
type WriteInput = Parameters<OrderWriteRepository['create']>[0]
function makeRepository(handler: (input: WriteInput) => Promise<unknown> = async () => ({ id: 'order-1' })) {
  const calls: WriteInput[] = []
  const repository: OrderWriteRepository = {
    create: async (input) => {
      calls.push(input)
      return handler(input)
    },
  }
  return { repository, calls }
}

describe('create order use case', () => {
  test('passes validated identity and a stable request hash to persistence', async () => {
    const { repository, calls } = makeRepository()
    const result = await submitOrder(repository, 'customer-1', { quoteId: QUOTE_ID }, 'request-1')
    expect(result).toEqual({ id: 'order-1' })
    expect(calls[0]).toMatchObject({
      quoteId: QUOTE_ID, customerId: 'customer-1', idempotencyKey: 'request-1',
    })
    expect(calls[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('keeps the same payload hash across retries', async () => {
    const { repository, calls } = makeRepository()
    await createOrder(repository, { quoteId: QUOTE_ID, customerId: 'customer-1', idempotencyKey: 'one' })
    await createOrder(repository, { quoteId: QUOTE_ID, customerId: 'customer-1', idempotencyKey: 'two' })
    expect(calls[0]?.requestHash).toBe(calls[1]?.requestHash)
  })

  test('rejects bad quote IDs and invalid idempotency keys before writing', async () => {
    const { repository, calls } = makeRepository()
    await expect(submitOrder(repository, 'customer-1', {}, 'key')).rejects.toMatchObject({
      status: 400, code: 'INVALID_QUOTE',
    })
    await expect(submitOrder(repository, 'customer-1', { quoteId: 'bad' }, 'key')).rejects.toMatchObject({
      status: 400, code: 'INVALID_QUOTE',
    })
    for (const key of [null, '', 'x'.repeat(121)]) {
      await expect(submitOrder(repository, 'customer-1', { quoteId: QUOTE_ID }, key))
        .rejects.toMatchObject({ status: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' })
    }
    expect(calls).toEqual([])
  })

  test('accepts an idempotency key at the maximum length', async () => {
    const { repository, calls } = makeRepository()
    await submitOrder(repository, 'customer-1', { quoteId: QUOTE_ID }, 'x'.repeat(120))
    expect(calls).toHaveLength(1)
  })

  test('maps every typed write conflict to its public error code', async () => {
    const cases: Array<[ConstructorParameters<typeof OrderWriteError>[0], number, string]> = [
      ['idempotency-conflict', 409, 'IDEMPOTENCY_CONFLICT'],
      ['quote-expired', 409, 'QUOTE_EXPIRED'],
      ['stock-unavailable', 409, 'STOCK_UNAVAILABLE'],
      ['stock-changed', 409, 'STOCK_UNAVAILABLE'],
      ['quote-changed', 409, 'QUOTE_CHANGED'],
      ['pharmacy-unavailable', 409, 'PHARMACY_UNAVAILABLE'],
      ['prescription-service-closed', 422, 'PRESCRIPTION_SERVICE_CLOSED'],
    ]
    for (const [reason, status, code] of cases) {
      const { repository } = makeRepository(async () => { throw new OrderWriteError(reason) })
      await expect(submitOrder(repository, 'customer-1', { quoteId: QUOTE_ID }, 'request-1'))
        .rejects.toMatchObject({ status, code })
    }
  })

  test('returns typed repository failures and rethrows unknown failures', async () => {
    const typed = makeRepository(async () => { throw new OrderWriteError('quote-expired') })
    await expect(createOrder(typed.repository, {
      quoteId: QUOTE_ID, customerId: 'customer-1', idempotencyKey: 'key',
    })).resolves.toEqual({ ok: false, reason: 'quote-expired' })
    const unknown = makeRepository(async () => { throw new Error('database unavailable') })
    await expect(createOrder(unknown.repository, {
      quoteId: QUOTE_ID, customerId: 'customer-1', idempotencyKey: 'key',
    })).rejects.toThrow('database unavailable')
  })
})
