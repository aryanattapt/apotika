import { publicProduct } from '../domain/product-view'
import { ApplicationError } from '../../../shared/application-error'

export type CatalogProductRow = {
  id: string
  sku: string
  name: string
  description: string | null
  category: string
  sell_unit: string
  requires_prescription: boolean
  batch_tracking_required: boolean
  indicative_price: string
  available: number
}

export interface CatalogRepository {
  findPublicProducts(query: string, category: string | null): Promise<CatalogProductRow[]>
  findPublicProduct(id: string): Promise<CatalogProductRow | null>
}

export async function listCatalogProducts(
  repository: CatalogRepository,
  rawQuery: string | null,
  category: string | null,
) {
  const query = (rawQuery ?? '').trim().slice(0, 100)
  const rows = await repository.findPublicProducts(query, category)
  return {
    items: rows.map(publicProduct),
    categories: [...new Set(rows.map((row) => row.category))],
  }
}

export async function getCatalogProduct(repository: CatalogRepository, id: string) {
  const row = await repository.findPublicProduct(id)
  if (!row) throw new ApplicationError(404, 'NOT_FOUND', 'Produk tidak ditemukan.')
  return publicProduct(row)
}
