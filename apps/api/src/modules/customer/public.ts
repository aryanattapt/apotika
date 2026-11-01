import { createAddress, listAddresses, updateAddress } from './application/address.service'
import type { AddressInputDto } from './application/address.dto'
import { PostgresAddressRepository } from './infrastructure/address.repository'

const repository = new PostgresAddressRepository()

export const listCustomerAddresses = (userId: string) => listAddresses(repository, userId)
export const createCustomerAddress = (userId: string, address: Partial<AddressInputDto>) =>
  createAddress(repository, userId, address)
export const updateCustomerAddress = (
  userId: string,
  addressId: string,
  address: Partial<AddressInputDto>,
) => updateAddress(repository, userId, addressId, address)
