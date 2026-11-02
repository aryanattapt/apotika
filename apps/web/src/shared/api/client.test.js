import { afterEach, describe, expect, test } from 'bun:test'
import { api } from './client.js'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(result) {
  const calls = []
  globalThis.fetch = async (...args) => {
    calls.push(args)
    return result
  }
  return calls
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('web API client', () => {
  test('prefixes API paths, includes cookies, and returns the data envelope', async () => {
    const calls = mockFetch(response({ data: { id: 'order-1' } }))
    const result = await api('/orders')
    expect(result).toEqual({ id: 'order-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('/api/v1/orders')
    expect(calls[0][1].credentials).toBe('include')
  })

  test('sets JSON and CSRF headers for writes while preserving caller headers', async () => {
    const body = JSON.stringify({ name: 'Vitamin C' })
    const calls = mockFetch(response({ data: { saved: true } }))
    await api('/products', {
      method: 'post',
      body,
      csrf: 'csrf-token',
      headers: { accept: 'application/json', 'x-csrf-token': 'old-token' },
    })
    const options = calls[0][1]
    const headers = new Headers(options.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('x-csrf-token')).toBe('csrf-token')
    expect(options.body).toBe(body)
  })

  test('does not add CSRF headers for safe methods or content type without a body', async () => {
    const calls = mockFetch(response({ data: [] }))
    await api('/products', { method: 'get', csrf: 'unused-token' })
    const headers = new Headers(calls[0][1].headers)
    expect(headers.has('x-csrf-token')).toBe(false)
    expect(headers.has('content-type')).toBe(false)
    expect(calls[0][1].credentials).toBe('include')
  })

  test('leaves multipart content type to the browser boundary encoder', async () => {
    const form = new FormData()
    form.append('note', 'label photo')
    const calls = mockFetch(response({ data: { uploaded: true } }))
    await api('/prescriptions/document', {
      method: 'POST',
      body: form,
      csrf: 'csrf-token',
    })
    const headers = new Headers(calls[0][1].headers)
    expect(headers.has('content-type')).toBe(false)
    expect(headers.get('x-csrf-token')).toBe('csrf-token')
    expect(calls[0][1].body).toBe(form)
  })

  test('surfaces structured API errors with their public status and code', async () => {
    const calls = mockFetch(response({
      error: { message: 'Stok berubah, silakan periksa keranjang.', code: 'STOCK_UNAVAILABLE' },
    }, 409))
    let error
    try {
      await api('/checkout/quote')
    } catch (caught) {
      error = caught
    }
    expect(calls).toHaveLength(1)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'Stok berubah, silakan periksa keranjang.',
      code: 'STOCK_UNAVAILABLE',
      status: 409,
    })
  })

  test('uses a safe fallback for failed responses that have no JSON body', async () => {
    mockFetch({
      ok: false,
      status: 503,
      json: async () => { throw new Error('invalid json') },
    })
    let error
    try {
      await api('/health')
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({
      message: 'Permintaan belum dapat diproses.',
      status: 503,
    })
    expect(error.code).toBeUndefined()
  })
})
