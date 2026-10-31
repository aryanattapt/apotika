import { decryptMfaSecret, verifyTotp } from '../../../../infrastructure/security/mfa'
import * as shared from '../../../../shared/api'
import type { User } from '../../../../shared/api'
import { pool, transaction } from '../../../../infrastructure/database/client'
import type { PublicRouteContext } from '../../../../shared/http/route-context'
import { createSession, issueToken } from '../../infrastructure/session.repository'
import { hash } from '../../../../shared/security/hash'
import { recordAudit } from '../../../platform'
const { apiError, body, cookieValue, expiredCookie, json, limit, requireRole, sessionCookie, userJson } = shared

export async function handleAuthRoutes({ request, url, path, method, requestId, user }: PublicRouteContext): Promise<Response | null> {
  if (path === '/auth/session' && method === 'GET') return json({ user: user ? userJson(user) : null })

  if (path === '/auth/register' && method === 'POST') {
    limit(request, 'register', 5)
    const input = await body<any>(request)
    const name = String(input.name ?? '').trim()
    const email = input.email ? String(input.email).trim().toLowerCase() : null
    const phone = input.phone ? String(input.phone).trim() : null
    const password = String(input.password ?? '')
    if (name.length < 2 || name.length > 100 || (!email && !phone) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || (phone && !/^\+?[0-9\s()-]{8,20}$/.test(phone))) {
      apiError(400, 'INVALID_PROFILE', 'Nama dan email atau nomor telepon yang valid diperlukan.')
    }
    if (password.length < 12 || password.length > 128) apiError(400, 'WEAK_PASSWORD', 'Kata sandi harus berisi 12–128 karakter.')
    const target = email ?? phone
    const created = await transaction(async (client) => {
      const result = await client.query(`INSERT INTO users(name,email,phone,password_hash) VALUES($1,$2,$3,$4)
        RETURNING id`, [name, email, phone, await Bun.password.hash(password)])
      const id = result.rows[0].id
      await client.query("INSERT INTO user_roles(user_id,role) VALUES($1,'customer')", [id])
      const verificationUrl = await issueToken(id, email ? 'verify_email' : 'verify_phone', target, client)
      return { verificationUrl }
    })
    return json({ message: 'Akun dibuat. Verifikasi kontak sebelum transaksi.', verificationUrl: created.verificationUrl }, 201)
  }

  if (path === '/auth/contact-verification' && method === 'POST') {
    limit(request, 'verify', 10)
    const input = await body<any>(request)
    const token = String(input.token ?? '')
    if (!token) apiError(400, 'TOKEN_REQUIRED', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
    await transaction(async (client) => {
      const result = await client.query(`UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND type IN ('verify_email','verify_phone')
        AND used_at IS NULL AND expires_at>now() RETURNING user_id,type,target_contact`, [hash(token)])
      if (!result.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
      const row = result.rows[0]
      const column = row.type === 'verify_email' ? 'email_verified_at' : 'phone_verified_at'
      const contactColumn = row.type === 'verify_email' ? 'email' : 'phone'
      const updated = await client.query(`UPDATE users SET ${column}=now(), updated_at=now() WHERE id=$1 AND ${contactColumn}=$2`, [row.user_id, row.target_contact])
      if (!updated.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan verifikasi tidak valid atau kedaluwarsa.')
      await recordAudit(client,row.user_id,'auth.contact_verified','user',row.user_id,{contactType:row.type})
    })
    return json({ message: 'Kontak berhasil diverifikasi. Silakan masuk.' })
  }

  if (path === '/auth/password-reset' && method === 'POST') {
    limit(request, 'password-reset', 5)
    const input = await body<any>(request)
    if (input.token && input.newPassword) {
      const newPassword = String(input.newPassword)
      if (newPassword.length < 12 || newPassword.length > 128) apiError(400, 'WEAK_PASSWORD', 'Kata sandi harus berisi 12–128 karakter.')
      const passwordHash = await Bun.password.hash(newPassword)
      await transaction(async (client) => {
        const token = await client.query(`UPDATE auth_tokens SET used_at=now() WHERE token_hash=$1 AND type='password_reset' AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [hash(String(input.token))])
        if (!token.rowCount) apiError(400, 'INVALID_TOKEN', 'Tautan reset tidak valid atau kedaluwarsa.')
        const userId = token.rows[0].user_id
        await client.query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [userId, passwordHash])
        await client.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId])
        await recordAudit(client,userId,'auth.password_reset','user',userId,{})
      })
      return json({ message: 'Kata sandi berhasil diperbarui. Silakan masuk kembali.' })
    }
    const contact = String(input.contact ?? '').trim().toLowerCase()
    const result = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1', [contact])
    let resetUrl: string | null = null
    if (result.rowCount) resetUrl = await issueToken(result.rows[0].id, 'password_reset', contact)
    return json({ message: 'Jika akun cocok, petunjuk pemulihan akan dikirim.', resetUrl })
  }

  if (path === '/auth/login' && method === 'POST') {
    limit(request, 'login', 12)
    const input = await body<any>(request)
    const password = String(input.password ?? '')
    if (password.length < 1 || password.length > 128) apiError(401, 'INVALID_CREDENTIALS', 'Email/telepon atau kata sandi tidak cocok.')
    const contact = String(input.contact ?? '').trim()
    const result = await pool.query(`SELECT id,name,email,phone,email_verified_at,phone_verified_at,password_hash,status,mfa_enabled,mfa_secret_encrypted FROM users
      WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1`, [contact])
    if (!result.rowCount || !(await Bun.password.verify(password, result.rows[0].password_hash))) {
      apiError(401, 'INVALID_CREDENTIALS', 'Email/telepon atau kata sandi tidak cocok.')
    }
    const account = result.rows[0]
    if (account.status === 'disabled') apiError(403, 'ACCOUNT_DISABLED', 'Akun ini sedang dinonaktifkan.')
    const roles = await pool.query('SELECT role,pharmacy_id FROM user_roles WHERE user_id=$1', [account.id])
    const internal = roles.rows.some((entry:any)=>entry.role!=='customer')
    if(internal){
      if(!account.mfa_enabled||!account.mfa_secret_encrypted)apiError(403,'MFA_SETUP_REQUIRED','Akun internal memerlukan MFA sebelum dapat digunakan.')
      let valid=false
      try{valid=verifyTotp(decryptMfaSecret(account.mfa_secret_encrypted),String(input.mfaCode??''))}catch{apiError(503,'MFA_UNAVAILABLE','Konfigurasi keamanan MFA belum tersedia.')}
      if(!valid&&String(input.mfaCode??'').length>=16){
        const recovery=await pool.query('UPDATE mfa_recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id',[account.id,hash(String(input.mfaCode).trim().toUpperCase())])
        valid=Boolean(recovery.rowCount)
      }
      if(!valid)apiError(401,'MFA_REQUIRED','Masukkan kode 6 digit dari aplikasi autentikator.')
    }
    const session = await createSession(account.id)
    const loggedIn: User = { ...account, roles: roles.rows.map((r: any) => ({ role: r.role, pharmacyId: r.pharmacy_id })), csrfToken: session.csrf }
    return json({ user: userJson(loggedIn) }, 200, { 'set-cookie': sessionCookie(session.token) })
  }

  if (path === '/auth/logout' && method === 'POST') {
    const token = cookieValue(request, 'apotek_session')
    if (token) await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE session_token_hash=$1', [hash(token)])
    return json({ message: 'Anda telah keluar.' }, 200, { 'set-cookie': expiredCookie() })
  }

  return null
}
