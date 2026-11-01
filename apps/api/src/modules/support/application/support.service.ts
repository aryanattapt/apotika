import { ApplicationError } from '../../../shared/application-error'
import { canAccessPharmacy, hasRole, type User } from '../../../shared/domain/access'
import type {
  CancellationDecisionDto,
  CancellationRequestDto,
  CreateSupportCaseDto,
  UpdateSupportCaseDto,
} from './support.dto'

export type SupportResult<T, Reason extends string> =
  { ok: true; value: T } | { ok: false; reason: Reason }

export interface SupportRepository {
  requestCancellation(
    orderId: string,
    actorId: string,
    reason: string,
    canModerate: boolean,
  ): Promise<SupportResult<unknown, 'not-found' | 'forbidden' | 'cancellation-not-allowed'>>
  decideCancellation(
    requestId: string,
    actorId: string,
    input: CancellationDecisionDto,
  ): Promise<
    SupportResult<
      unknown,
      'not-found' | 'already-decided' | 'invalid-decision' | 'cancellation-not-allowed'
    >
  >
  findOrderForCases(orderId: string): Promise<{ customer_id: string; pharmacy_id: string } | null>
  listCases(orderId: string): Promise<unknown[]>
  createCase(
    orderId: string,
    actorId: string,
    canOpenForOthers: boolean,
    input: CreateSupportCaseDto,
  ): Promise<SupportResult<unknown, 'not-found' | 'forbidden'>>
  updateCase(
    caseId: string,
    actorId: string,
    assignedTo: string,
    input: UpdateSupportCaseDto,
  ): Promise<SupportResult<unknown, 'invalid-assignee' | 'not-found'>>
}

export async function requestOrderCancellation(
  repository: SupportRepository,
  orderId: string,
  user: User,
  input: CancellationRequestDto,
) {
  const reason = String(input.reason ?? '').trim()
  if (reason.length < 3 || reason.length > 500)
    throw new ApplicationError(400, 'INVALID_REASON', 'Alasan pembatalan wajib diisi.')
  const result = await repository.requestCancellation(
    orderId,
    user.id,
    reason,
    hasRole(user, 'cs', 'admin'),
  )
  if (result.ok) return result.value
  if (result.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  if (result.reason === 'forbidden')
    throw new ApplicationError(403, 'FORBIDDEN', 'Tidak dapat meminta pembatalan pesanan ini.')
  throw new ApplicationError(
    409,
    'CANCELLATION_NOT_ALLOWED',
    'Pesanan sudah diserahkan atau berakhir. Buat kasus bantuan.',
  )
}

export async function decideOrderCancellation(
  repository: SupportRepository,
  requestId: string,
  user: User,
  input: CancellationDecisionDto,
) {
  const result = await repository.decideCancellation(requestId, user.id, input)
  if (result.ok) return result.value
  if (result.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Permintaan pembatalan tidak ditemukan.')
  if (result.reason === 'already-decided')
    throw new ApplicationError(409, 'ALREADY_DECIDED', 'Permintaan pembatalan sudah diputuskan.')
  if (result.reason === 'invalid-decision')
    throw new ApplicationError(400, 'INVALID_DECISION', 'Keputusan tidak valid.')
  throw new ApplicationError(
    409,
    'CANCELLATION_NOT_ALLOWED',
    'Pesanan sudah diserahkan atau berakhir.',
  )
}

export async function listOrderSupportCases(
  repository: SupportRepository,
  orderId: string,
  user: User,
) {
  const order = await repository.findOrderForCases(orderId)
  if (!order) throw new ApplicationError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  if (
    order.customer_id !== user.id &&
    !hasRole(user, 'cs', 'finance', 'admin') &&
    !canAccessPharmacy(user, order.pharmacy_id)
  )
    throw new ApplicationError(403, 'PHARMACY_SCOPE_REQUIRED', 'Akses apotek ini tidak diizinkan.')
  return repository.listCases(orderId)
}

export async function openSupportCase(
  repository: SupportRepository,
  orderId: string,
  user: User,
  input: CreateSupportCaseDto,
) {
  const description = String(input.description ?? '').trim()
  const category = String(input.category ?? 'other').slice(0, 50)
  if (description.length < 4 || description.length > 2000)
    throw new ApplicationError(400, 'INVALID_CASE', 'Jelaskan kendala dengan singkat.')
  const result = await repository.createCase(
    orderId,
    user.id,
    hasRole(user, 'cs', 'finance', 'admin'),
    { description, category },
  )
  if (result.ok) return result.value
  if (result.reason === 'not-found')
    throw new ApplicationError(404, 'NOT_FOUND', 'Pesanan tidak ditemukan.')
  throw new ApplicationError(403, 'FORBIDDEN', 'Tidak dapat membuka kasus untuk pesanan ini.')
}

export async function updateSupportCase(
  repository: SupportRepository,
  caseId: string,
  user: User,
  input: UpdateSupportCaseDto,
) {
  if (!['open', 'in_progress', 'closed'].includes(input.status))
    throw new ApplicationError(400, 'INVALID_STATUS', 'Status kasus tidak valid.')
  const assignedTo =
    input.assignedTo && isUuid(String(input.assignedTo)) ? String(input.assignedTo) : user.id
  const result = await repository.updateCase(caseId, user.id, assignedTo, input)
  if (result.ok) return result.value
  if (result.reason === 'invalid-assignee')
    throw new ApplicationError(400, 'INVALID_ASSIGNEE', 'Penanggung jawab harus akun operasional.')
  throw new ApplicationError(404, 'NOT_FOUND', 'Kasus bantuan tidak ditemukan.')
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
