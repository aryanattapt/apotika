import { amount } from '../../../shared/domain/money'
import { ApplicationError } from '../../../shared/application-error'
import { canAccessPharmacy, hasRole, type User } from '../../../shared/domain/access'
import { isValidServiceExceptions, isValidServiceHours } from '../domain/service-hours'
import type {
  InventoryAdjustmentDto,
  ReplaceServiceHoursDto,
  ReplaceServiceHoursRequestDto,
} from './pharmacy.dto'

export type PharmacyInventoryRow = {
  pharmacy_id: string
  product_id: string
  sku: string
  name: string
  sell_unit: string
  requires_prescription: boolean
  on_hand: number
  reserved: number
  unit_price: string
  sales_blocked: boolean
}

export type InventoryAdjustmentResult =
  | { ok: true; onHand: number; reserved: number }
  | { ok: false; reason: 'not-found' | 'reservation-conflict' }

export interface PharmacyRepository {
  listInventory(pharmacyIds: string[] | null): Promise<PharmacyInventoryRow[]>
  adjustInventory(
    actorId: string,
    input: InventoryAdjustmentDto,
  ): Promise<InventoryAdjustmentResult>
  replaceServiceHours(
    pharmacyId: string,
    actorId: string,
    input: ReplaceServiceHoursDto,
  ): Promise<void>
}

export async function listPharmacyInventory(repository: PharmacyRepository, user: User) {
  const pharmacyIds = user.roles
    .filter((role) => role.pharmacyId && ['pharmacist', 'pharmacy_staff'].includes(role.role))
    .map((role) => role.pharmacyId!)
  const rows = await repository.listInventory(hasRole(user, 'admin') ? null : pharmacyIds)
  return rows.map((row) => ({
    pharmacyId: row.pharmacy_id,
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    sellUnit: row.sell_unit,
    requiresPrescription: row.requires_prescription,
    onHand: row.on_hand,
    reserved: row.reserved,
    available: Number(row.on_hand) - Number(row.reserved),
    unitPrice: amount(row.unit_price),
    salesBlocked: row.sales_blocked,
  }))
}

export async function adjustPharmacyInventory(
  repository: PharmacyRepository,
  user: User,
  input: Partial<InventoryAdjustmentDto>,
) {
  const pharmacyId = String(input.pharmacyId ?? '')
  const productId = String(input.productId ?? '')
  const delta = Number(input.delta)
  const reason = String(input.reason ?? '').trim()
  if (!isUuid(pharmacyId) || !isUuid(productId) || !Number.isInteger(delta) || !reason)
    throw new ApplicationError(
      400,
      'INVALID_ADJUSTMENT',
      'Produk, jumlah perubahan, dan alasan diperlukan.',
    )
  if (!canAccessPharmacy(user, pharmacyId))
    throw new ApplicationError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
  const result = await repository.adjustInventory(user.id, { pharmacyId, productId, delta, reason })
  if (result.ok) return { onHand: result.onHand, reserved: result.reserved }
  if (result.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Alokasi produk tidak ditemukan.')
  throw new ApplicationError(
    409,
    'RESERVATION_CONFLICT',
    'Stok tidak dapat dikurangi di bawah jumlah yang sudah direservasi.',
  )
}

export async function replacePharmacyServiceHours(
  repository: PharmacyRepository,
  pharmacyId: string,
  user: User,
  input: ReplaceServiceHoursRequestDto,
) {
  if (!isValidServiceHours(input.hours))
    throw new ApplicationError(400, 'INVALID_HOURS', 'Jadwal layanan tidak valid.')
  const exceptions = Array.isArray(input.exceptions) ? input.exceptions : []
  if (!isValidServiceExceptions(exceptions))
    throw new ApplicationError(400, 'INVALID_HOURS', 'Pengecualian jam layanan tidak valid.')
  if (!canAccessPharmacy(user, pharmacyId))
    throw new ApplicationError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
  return repository.replaceServiceHours(pharmacyId, user.id, {
    hours: input.hours,
    exceptions,
  })
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
