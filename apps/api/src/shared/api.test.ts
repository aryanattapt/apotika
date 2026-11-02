import { afterEach, describe, expect, test } from 'bun:test'
import { ApiError, configureRequestIpResolver, limit, rateBuckets } from './api'

afterEach(() => {
  rateBuckets.clear()
  configureRequestIpResolver(() => 'test-peer')
})

function request(forwardedFor?: string) {
  return new Request('https://api.example.test/api/v1/auth/login', {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  })
}

describe('API rate limits', () => {
  test('isolates normalized identities without retaining their raw values', () => {
    configureRequestIpResolver(() => 'shared-proxy')
    limit(request(), 'login', 2, '  Arya@Example.test  ')
    limit(request(), 'login', 2, 'arya@example.test')
    limit(request(), 'login', 2, 'other@example.test')

    expect([...rateBuckets.keys()].some((key) => key.includes('arya@example.test'))).toBe(false)
    expect(() => limit(request(), 'login', 2, 'ARYA@example.test')).toThrow(ApiError)
    expect(() => limit(request(), 'login', 2, 'third@example.test')).not.toThrow()
  })

  test('does not trust client-controlled forwarded headers as the source IP', () => {
    configureRequestIpResolver(() => 'reverse-proxy')
    limit(request('198.51.100.10'), 'legacy', 1)
    expect(() => limit(request('203.0.113.11'), 'legacy', 1)).toThrow(ApiError)
  })

  test('keeps a per-peer ceiling while allowing separate user identities', () => {
    configureRequestIpResolver(() => 'shared-proxy')
    for (let index = 0; index < 1_000; index++)
      limit(request(), 'login', 1, 'identity-' + index)

    const error = (() => {
      try {
        limit(request(), 'login', 1, 'identity-over-limit')
        return null
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED' })
  })
})
