import type { AddressInputDto } from './address.dto'
import { ApplicationError } from '../../../shared/application-error'

export interface AddressRepository {
  listForUser(userId: string): Promise<unknown[]>
  createForUser(userId: string, address: AddressInputDto): Promise<unknown>
  updateForUser(userId: string, addressId: string, address: AddressInputDto): Promise<boolean>
}

export function listAddresses(repository: AddressRepository, userId: string) {
  return repository.listForUser(userId)
}

export function createAddress(
  repository: AddressRepository,
  userId: string,
  input: Partial<AddressInputDto>,
) {
  const address = normalizeAddress(input)
  if (
    Object.values(address).some((value) => !value) ||
    address.recipientName.length > 100 ||
    address.addressText.length > 500
  )
    throw new ApplicationError(
      400,
      'INVALID_ADDRESS',
      'Lengkapi nama penerima, telepon, alamat, kota, dan kode pos.',
    )
  return repository.createForUser(userId, address)
}

export async function updateAddress(
  repository: AddressRepository,
  userId: string,
  addressId: string,
  input: Partial<AddressInputDto>,
) {
  const address = normalizeAddress(input)
  if (Object.values(address).some((value) => !value))
    throw new ApplicationError(400, 'INVALID_ADDRESS', 'Semua kolom alamat diperlukan.')
  if (!(await repository.updateForUser(userId, addressId, address)))
    throw new ApplicationError(404, 'NOT_FOUND', 'Alamat tidak ditemukan.')
}

function normalizeAddress(input: Partial<AddressInputDto>): AddressInputDto {
  return {
    recipientName: String(input.recipientName ?? '').trim(),
    phone: String(input.phone ?? '').trim(),
    addressText: String(input.addressText ?? '').trim(),
    city: String(input.city ?? '').trim(),
    postalCode: String(input.postalCode ?? '').trim(),
  }
}
