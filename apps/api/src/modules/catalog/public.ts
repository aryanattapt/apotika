import { getCatalogProduct, listCatalogProducts } from './application/catalog.service'
import { PostgresCatalogRepository } from './infrastructure/catalog.repository'

const repository = new PostgresCatalogRepository()

export const getPublicProduct = (id: string) => getCatalogProduct(repository, id)
export const listPublicProducts = (query: string | null, category: string | null) =>
  listCatalogProducts(repository, query, category)
