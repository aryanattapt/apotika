import { randomUUID } from 'node:crypto'
import {
  API,
  ApiError,
  MAX_REQUEST_BODY_BYTES,
  WEB_ORIGIN,
  apiError,
  configureRequestIpResolver,
  cookieValue,
  errorJson,
} from './shared/api'
import { ApplicationError } from './shared/application-error'
import { route } from './interfaces/http/router'
import { expireUnpaidOrders } from './application/jobs/expire-unpaid-orders'
import { findUserForSessionToken } from './modules/identity'

const server = Bun.serve({
  port: Number(process.env.API_PORT ?? 4000),
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  async fetch(request) {
    const requestId = randomUUID()
    const origin = request.headers.get('origin')
    if (origin && origin !== WEB_ORIGIN)
      return new Response('Origin tidak diizinkan.', { status: 403 })
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': WEB_ORIGIN,
          'access-control-allow-credentials': 'true',
          'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
          'access-control-allow-headers': 'content-type,x-csrf-token,idempotency-key',
        },
      })
    if (!new URL(request.url).pathname.startsWith(API + '/'))
      return new Response('Not found', { status: 404 })
    try {
      const contentLength = Number(request.headers.get('content-length') ?? 0)
      if (contentLength > MAX_REQUEST_BODY_BYTES)
        apiError(413, 'REQUEST_TOO_LARGE', 'Ukuran permintaan melebihi batas yang diizinkan.')
      const user = await findUserForSessionToken(cookieValue(request, 'apotek_session'))
      const path = new URL(request.url).pathname.slice(API.length)
      const publicWrite = [
        '/auth/register',
        '/auth/login',
        '/auth/contact-verification',
        '/auth/password-reset',
      ].includes(path)
      if (
        user &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        !publicWrite &&
        request.headers.get('x-csrf-token') !== user.csrfToken
      ) {
        apiError(403, 'CSRF_INVALID', 'Sesi tidak valid. Muat ulang halaman dan coba lagi.')
      }
      const response = await route(request, user, requestId)
      response.headers.set('x-request-id', requestId)
      if (origin === WEB_ORIGIN) {
        response.headers.set('access-control-allow-origin', WEB_ORIGIN)
        response.headers.set('access-control-allow-credentials', 'true')
        response.headers.append('vary', 'Origin')
      }
      return response
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string }
      const api =
        error instanceof ApiError
          ? error
          : error instanceof ApplicationError
            ? new ApiError(error.status, error.code, error.message)
            : databaseError?.code === '23505' &&
                ['users_email_unique', 'users_phone_unique'].includes(
                  databaseError.constraint ?? '',
                )
              ? new ApiError(409, 'CONTACT_IN_USE', 'Email atau nomor telepon sudah terdaftar.')
              : databaseError?.code === '23505'
                ? new ApiError(
                    409,
                    'RESOURCE_CONFLICT',
                    'Permintaan ini bertentangan dengan data yang sudah ada.',
                  )
                : new ApiError(
                    500,
                    'INTERNAL_ERROR',
                    'Terjadi gangguan. Coba lagi atau hubungi bantuan.',
                  )
      if (!(error instanceof ApiError))
        console.error(
          JSON.stringify({ requestId, error: error instanceof Error ? error.message : 'unknown' }),
        )
      const response = errorJson(api, requestId)
      if (origin === WEB_ORIGIN) {
        response.headers.set('access-control-allow-origin', WEB_ORIGIN)
        response.headers.set('access-control-allow-credentials', 'true')
      }
      return response
    }
  },
})

configureRequestIpResolver((request) => server.requestIP(request)?.address)
console.info(`API FarmaGO berjalan di http://localhost:${server.port}`)
const expirationTimer = setInterval(() => {
  void expireUnpaidOrders().catch(() =>
    console.error('Pekerjaan kedaluwarsa reservasi gagal; akan dicoba kembali.'),
  )
}, 15_000)
expirationTimer.unref?.()
