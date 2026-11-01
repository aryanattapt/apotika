import {
  adjustPharmacyInventory,
  listPharmacyInventory,
  replacePharmacyServiceHours,
} from './application/pharmacy.service'
import type {
  InventoryAdjustmentDto,
  ReplaceServiceHoursRequestDto,
} from './application/pharmacy.dto'
import type { User } from '../../shared/domain/access'
import { PostgresPharmacyRepository } from './infrastructure/pharmacy.repository'

const repository = new PostgresPharmacyRepository()

export const getPharmacyInventory = (user: User) => listPharmacyInventory(repository, user)
export const adjustInventory = (user: User, input: Partial<InventoryAdjustmentDto>) =>
  adjustPharmacyInventory(repository, user, input)
export const updatePharmacyServiceHours = (
  pharmacyId: string,
  user: User,
  input: ReplaceServiceHoursRequestDto,
) => replacePharmacyServiceHours(repository, pharmacyId, user, input)
