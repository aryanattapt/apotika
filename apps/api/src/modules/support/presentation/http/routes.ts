import * as shared from '../../../../shared/api'
import type { AuthenticatedRouteContext } from '../../../../shared/http/route-context'
import {
  createSupportCase,
  decideCancellation,
  listSupportCases,
  requestCancellation,
  updateSupportCaseById,
} from '../../public'
import type {
  CancellationDecisionRequestDto,
  CancellationRequestDto,
  CreateSupportCaseRequestDto,
  UpdateSupportCaseRequestDto,
} from './dto'

const { body, json, requireRole } = shared

export async function handleSupportRoutes({
  request,
  path,
  method,
  currentUser,
}: AuthenticatedRouteContext): Promise<Response | null> {
  const cancellationMatch = path.match(/^\/orders\/([0-9a-f-]+)\/cancellation-requests$/i)
  if (cancellationMatch && method === 'POST') {
    const input = await body<CancellationRequestDto>(request)
    const result = await requestCancellation(cancellationMatch[1], currentUser, input)
    return json(result, 201)
  }
  const cancellationDecision = path.match(/^\/cancellation-requests\/([0-9a-f-]+)\/decision$/i)
  if (cancellationDecision && method === 'POST') {
    requireRole(currentUser, 'cs', 'admin')
    const input = await body<CancellationDecisionRequestDto>(request)
    const result = await decideCancellation(cancellationDecision[1], currentUser, input)
    return json(result)
  }

  const casesMatch = path.match(/^\/orders\/([0-9a-f-]+)\/support-cases$/i)
  if (casesMatch && method === 'GET')
    return json({ items: await listSupportCases(casesMatch[1], currentUser) })
  if (casesMatch && method === 'POST') {
    const input = await body<CreateSupportCaseRequestDto>(request)
    return json(await createSupportCase(casesMatch[1], currentUser, input), 201)
  }
  const caseMatch = path.match(/^\/support-cases\/([0-9a-f-]+)$/i)
  if (caseMatch && method === 'PATCH') {
    requireRole(currentUser, 'cs', 'finance', 'admin')
    const input = await body<UpdateSupportCaseRequestDto>(request)
    return json(await updateSupportCaseById(caseMatch[1], currentUser, input))
  }

  return null
}
