import { hash } from '../../../shared/security/hash'
import { ApplicationError } from '../../../shared/application-error'
import type { CreateOrderRequestDto } from './create-order.dto'

export type OrderWriteFailure =
  | 'idempotency-conflict'
  | 'quote-expired'
  | 'stock-unavailable'
  | 'stock-changed'
  | 'quote-changed'
  | 'pharmacy-unavailable'
  | 'prescription-service-closed'

export class OrderWriteError extends Error {
  constructor(readonly reason: OrderWriteFailure) {
    super(reason)
  }
}

export interface OrderWriteRepository {
  create(input: {
    quoteId: string
    customerId: string
    idempotencyKey: string
    requestHash: string
  }): Promise<unknown>
}

export type CreateOrderResult =
  { ok: true; order: unknown } | { ok: false; reason: OrderWriteFailure }

export async function createOrder(
  repository: OrderWriteRepository,
  input: { quoteId: string; customerId: string; idempotencyKey: string },
): Promise<CreateOrderResult> {
  try {
    const order = await repository.create({
      ...input,
      requestHash: hash(JSON.stringify({ quoteId: input.quoteId })),
    })
    return { ok: true, order }
  } catch (error) {
    if (error instanceof OrderWriteError) return { ok: false, reason: error.reason }
    throw error
  }
}

export async function submitOrder(
  repository: OrderWriteRepository,
  customerId: string,
  input: CreateOrderRequestDto,
  idempotencyKey: string | null,
) {
  const quoteId = String(input.quoteId ?? '')
  if (!isUuid(quoteId)) throw new ApplicationError(400, 'INVALID_QUOTE', 'Quote tidak valid.')
  if (!idempotencyKey || idempotencyKey.length > 120)
    throw new ApplicationError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Kunci idempotensi wajib disertakan.',
    )
  const result = await createOrder(repository, { quoteId, customerId, idempotencyKey })
  if (result.ok) return result.order
  if (result.reason === 'idempotency-conflict')
    throw new ApplicationError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Kunci permintaan sudah digunakan dengan isi berbeda.',
    )
  if (result.reason === 'quote-expired')
    throw new ApplicationError(
      409,
      'QUOTE_EXPIRED',
      'Rincian belanja kedaluwarsa. Perbarui keranjang dan tinjau rincian baru.',
    )
  if (result.reason === 'stock-unavailable')
    throw new ApplicationError(
      409,
      'STOCK_UNAVAILABLE',
      'Sebagian produk tidak tersedia. Perbarui keranjang.',
    )
  if (result.reason === 'stock-changed')
    throw new ApplicationError(
      409,
      'STOCK_UNAVAILABLE',
      'Stok berubah dan tidak cukup. Perbarui keranjang.',
    )
  if (result.reason === 'quote-changed')
    throw new ApplicationError(
      409,
      'QUOTE_CHANGED',
      'Harga, alamat, atau biaya berubah. Tinjau quote baru sebelum pesanan dibuat.',
    )
  if (result.reason === 'pharmacy-unavailable')
    throw new ApplicationError(
      409,
      'PHARMACY_UNAVAILABLE',
      'Apotek pilihan tidak lagi menerima pesanan. Buat quote baru.',
    )
  throw new ApplicationError(
    422,
    'PRESCRIPTION_SERVICE_CLOSED',
    'Layanan pemeriksaan resep sedang tutup. Coba kembali saat layanan tersedia.',
  )
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
