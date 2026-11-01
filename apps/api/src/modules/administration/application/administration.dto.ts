export type CreateProductRequestDto = {
  sku?: string
  name?: string
  category?: string
  sellUnit?: string
  description?: string
  requiresPrescription?: boolean
  batchTrackingRequired?: boolean
  specialHandling?: boolean
}

export type ConfigureInventoryRequestDto = {
  pharmacyId?: string
  productId?: string
  onHand?: number | string
  unitPrice?: number | string
  reason?: string
}

export type UpdateProductRequestDto = {
  name?: string | null
  description?: string | null
  category?: string | null
  sellUnit?: string | null
  requiresPrescription?: boolean | null
  batchTrackingRequired?: boolean | null
  specialHandling?: boolean | null
  status?: string
}

export type CreatePharmacyRequestDto = {
  name?: string
  addressText?: string
  city?: string
  postalCodes?: unknown
  licenseReference?: string
}

export type UpdatePharmacyRequestDto = {
  status?: string
}
