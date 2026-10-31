import { randomBytes } from 'node:crypto'
import { pool } from '../../../infrastructure/database/client'
import { hash } from '../../../shared/security/hash'
import { SESSION_SECONDS, WEB_ORIGIN } from '../../../shared/config'

export async function findUserForSessionToken(token: string | null) {
  if (!token) return null
  const result = await pool.query(`
    SELECT s.id AS session_id, s.csrf_token, u.id, u.name, u.email, u.phone, u.email_verified_at, u.phone_verified_at
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.session_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='active'
  `, [hash(token)])
  if (!result.rowCount) return null
  const row = result.rows[0]
  const roles = await pool.query('SELECT role, pharmacy_id FROM user_roles WHERE user_id=$1', [row.id])
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    email_verified_at: row.email_verified_at,
    phone_verified_at: row.phone_verified_at,
    roles: roles.rows.map((role) => ({ role: role.role, pharmacyId: role.pharmacy_id })),
    csrfToken: row.csrf_token,
  }
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  await pool.query(`INSERT INTO auth_sessions(user_id, session_token_hash, csrf_token, expires_at)
    VALUES ($1,$2,$3,now()+make_interval(secs=>$4::int))`, [userId, hash(token), csrf, SESSION_SECONDS])
  return { token, csrf }
}

export async function issueToken(userId: string, type: string, target: string | null, client: any = pool) {
  const token = randomBytes(32).toString('base64url')
  await client.query(`INSERT INTO auth_tokens(user_id,type,target_contact,token_hash,expires_at)
    VALUES ($1,$2,$3,$4,now()+interval '30 minutes')`, [userId, type, target, hash(token)])
  const parameter = type === 'password_reset' ? 'reset' : 'verify'
  return process.env.NODE_ENV === 'production' ? null : `${WEB_ORIGIN}/?${parameter}=${encodeURIComponent(token)}`
}
