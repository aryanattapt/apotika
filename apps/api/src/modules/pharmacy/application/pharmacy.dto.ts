import type { ServiceException, ServiceHours } from '../domain/service-hours'

export type InventoryAdjustmentDto = {
  pharmacyId: string
  productId: string
  delta: number
  reason: string
}

export type ReplaceServiceHoursDto = {
  hours: ServiceHours[]
  exceptions: Array<ServiceException & { reason?: string }>
}

export type ReplaceServiceHoursRequestDto = {
  hours?: unknown
  exceptions?: unknown
}
