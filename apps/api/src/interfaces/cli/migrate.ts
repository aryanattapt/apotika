import { pool } from '../../infrastructure/database/client'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../infrastructure/database/migrations')
const client = await pool.connect()
try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])
    if (exists.rowCount) continue
    await client.query('BEGIN')
    try {
      await client.query(await readFile(join(dir, name), 'utf8'))
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
      await client.query('COMMIT')
      console.info(`Migration diterapkan: ${name}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
} finally {
  client.release()
  await pool.end()
}
