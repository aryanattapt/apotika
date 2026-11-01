export { insertAuditEvent as recordAudit } from './infrastructure/audit.repository'
import { getHealth } from './application/health.service'
import { PostgresHealthRepository } from './infrastructure/health.repository'

export const getPlatformHealth = () => getHealth(new PostgresHealthRepository())
