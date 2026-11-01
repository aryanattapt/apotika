import type { HealthResponseDto } from './health.dto'

export interface HealthRepository {
  isDatabaseReady(): Promise<boolean>
}

export async function getHealth(repository: HealthRepository): Promise<HealthResponseDto> {
  return { status: 'ok', database: await repository.isDatabaseReady() }
}
