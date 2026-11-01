import { sql } from 'drizzle-orm'
import { db } from '../../../infrastructure/database/client'
import type { HealthRepository } from '../application/health.service'

export class PostgresHealthRepository implements HealthRepository {
  async isDatabaseReady() {
    const result = await db.execute(sql`SELECT 1 AS ok`)
    return result.rowCount === 1
  }
}
