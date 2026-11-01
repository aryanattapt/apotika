import {
  configureAdminInventory,
  createAdminPharmacy,
  createAdminProduct,
  listAdminCancellationRequests,
  listAdminOrders,
  listAdminPharmacies,
  listAdminProducts,
  listAdminSupportCases,
  updateAdminPharmacy,
  updateAdminProduct,
} from './application/administration.service'
import { PostgresAdministrationRepository } from './infrastructure/administration.repository'

const repository = new PostgresAdministrationRepository()

export const getAdminProducts = () => listAdminProducts(repository)
export const getAdminPharmacies = () => listAdminPharmacies(repository)
export const getAdminOrders = () => listAdminOrders(repository)
export const getAdminCancellationRequests = () => listAdminCancellationRequests(repository)
export const getAdminSupportCases = () => listAdminSupportCases(repository)
export const createAdminProductRecord = (...args: Parameters<typeof createAdminProduct>) =>
  createAdminProduct(repository, ...args)
export const configureAdminInventoryRecord = (
  ...args: Parameters<typeof configureAdminInventory>
) => configureAdminInventory(repository, ...args)
export const updateAdminProductRecord = (...args: Parameters<typeof updateAdminProduct>) =>
  updateAdminProduct(repository, ...args)
export const createAdminPharmacyRecord = (...args: Parameters<typeof createAdminPharmacy>) =>
  createAdminPharmacy(repository, ...args)
export const updateAdminPharmacyRecord = (...args: Parameters<typeof updateAdminPharmacy>) =>
  updateAdminPharmacy(repository, ...args)
