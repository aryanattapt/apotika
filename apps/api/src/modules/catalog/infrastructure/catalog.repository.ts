import { and, asc, eq, ilike, notInArray, or, sql } from 'drizzle-orm'
import { db } from '../../../infrastructure/database/client'
import { inventory, pharmacies, products } from '../../../infrastructure/database/schema'
import type { CatalogProductRow, CatalogRepository } from '../application/catalog.service'

export class PostgresCatalogRepository implements CatalogRepository {
  async findPublicProducts(query: string, category: string | null): Promise<CatalogProductRow[]> {
    return db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        description: products.description,
        category: products.category,
        sell_unit: products.sellUnit,
        requires_prescription: products.requiresPrescription,
        batch_tracking_required: products.batchTrackingRequired,
        indicative_price: sql<string>`COALESCE(MIN(${inventory.unitPrice}), 0)`,
        available: sql<number>`COALESCE(MAX(${inventory.onHand} - ${inventory.reserved}), 0)`,
      })
      .from(products)
      .innerJoin(
        inventory,
        and(eq(inventory.productId, products.id), eq(inventory.salesBlocked, false)),
      )
      .innerJoin(
        pharmacies,
        and(eq(pharmacies.id, inventory.pharmacyId), eq(pharmacies.status, 'active')),
      )
      .where(
        and(
          eq(products.status, 'active'),
          notInArray(sql`lower(${products.category})`, ['narkotika', 'psikotropika']),
          query
            ? or(
                ilike(products.name, `%${query}%`),
                ilike(products.description, `%${query}%`),
                ilike(products.category, `%${query}%`),
              )
            : undefined,
          category ? eq(products.category, category) : undefined,
        ),
      )
      .groupBy(products.id)
      .orderBy(asc(products.category), asc(products.name))
      .limit(100)
  }

  async findPublicProduct(id: string): Promise<CatalogProductRow | null> {
    const [product] = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        description: products.description,
        category: products.category,
        sell_unit: products.sellUnit,
        requires_prescription: products.requiresPrescription,
        batch_tracking_required: products.batchTrackingRequired,
        indicative_price: sql<string>`COALESCE(MIN(${inventory.unitPrice}), 0)`,
        available: sql<number>`COALESCE(MAX(${inventory.onHand} - ${inventory.reserved}), 0)`,
      })
      .from(products)
      .innerJoin(
        inventory,
        and(eq(inventory.productId, products.id), eq(inventory.salesBlocked, false)),
      )
      .innerJoin(
        pharmacies,
        and(eq(pharmacies.id, inventory.pharmacyId), eq(pharmacies.status, 'active')),
      )
      .where(
        and(
          eq(products.id, id),
          eq(products.status, 'active'),
          notInArray(sql`lower(${products.category})`, ['narkotika', 'psikotropika']),
        ),
      )
      .groupBy(products.id)
      .limit(1)
    return product ?? null
  }
}
