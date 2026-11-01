import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

const { Pool } = pg
const connectionString = process.env.DATABASE_URL

if (!connectionString) throw new Error('DATABASE_URL wajib diatur.')

export const pool = new Pool({
  connectionString,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export const db = drizzle({ client: pool, schema })

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function json<T>(value: T): T {
  return value
}
