export type ProductListQueryDto = {
  query?: string
  category?: string
}

export type PublicProductResponseDto = {
  id: string
  sku: string
  name: string
  description: string | null
  category: string
  sellUnit: string
  requiresPrescription: boolean
  batchTrackingRequired: boolean
  indicativePrice: string
  available: boolean
  stock: number
}
