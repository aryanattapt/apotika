import * as shared from '../../../../shared/api'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
import {
  loginIdentityAccount,
  logoutIdentitySession,
  registerIdentityAccount,
  resetIdentityAccountPassword,
  verifyIdentityAccountContact,
} from '../../public'
import type {
  ContactVerificationRequestDto,
  LoginRequestDto,
  PasswordResetRequestDto,
  RegisterRequestDto,
} from './dto'

const { body, cookieValue, expiredCookie, json, limit, sessionCookie, userJson } = shared

export async function handleAuthRoutes({
  request,
  path,
  method,
  user,
}: PublicRouteContext): Promise<Response | null> {
  if (path === '/auth/session' && method === 'GET')
    return json({ user: user ? userJson(user) : null })

  if (path === '/auth/register' && method === 'POST') {
    limit(request, 'register', 5)
    const input = await body<RegisterRequestDto>(request)
    const created = await registerIdentityAccount(input)
    return json(
      {
        message: 'Akun dibuat. Verifikasi kontak sebelum transaksi.',
        verificationUrl: created.verificationUrl,
      },
      201,
    )
  }

  if (path === '/auth/contact-verification' && method === 'POST') {
    limit(request, 'verify', 10)
    const input = await body<ContactVerificationRequestDto>(request)
    await verifyIdentityAccountContact(input)
    return json({ message: 'Kontak berhasil diverifikasi. Silakan masuk.' })
  }

  if (path === '/auth/password-reset' && method === 'POST') {
    limit(request, 'password-reset', 5)
    const input = await body<PasswordResetRequestDto>(request)
    return json(await resetIdentityAccountPassword(input))
  }

  if (path === '/auth/login' && method === 'POST') {
    limit(request, 'login', 12)
    const input = await body<LoginRequestDto>(request)
    const login = await loginIdentityAccount(input)
    return json({ user: userJson(login.user) }, 200, { 'set-cookie': sessionCookie(login.token) })
  }

  if (path === '/auth/logout' && method === 'POST') {
    await logoutIdentitySession(cookieValue(request, 'apotek_session'))
    return json({ message: 'Anda telah keluar.' }, 200, { 'set-cookie': expiredCookie() })
  }

  return null
}
