import {
  decideOrderCancellation,
  listOrderSupportCases,
  openSupportCase,
  requestOrderCancellation,
  updateSupportCase,
} from './application/support.service'
import type {
  CancellationRequestDto,
  CancellationDecisionDto,
  CreateSupportCaseDto,
  UpdateSupportCaseDto,
} from './application/support.dto'
import type { User } from '../../shared/domain/access'
import { PostgresSupportRepository } from './infrastructure/support.repository'

const repository = new PostgresSupportRepository()

export const requestCancellation = (orderId: string, user: User, input: CancellationRequestDto) =>
  requestOrderCancellation(repository, orderId, user, input)
export const decideCancellation = (requestId: string, user: User, input: CancellationDecisionDto) =>
  decideOrderCancellation(repository, requestId, user, input)
export const listSupportCases = (orderId: string, user: User) =>
  listOrderSupportCases(repository, orderId, user)
export const createSupportCase = (orderId: string, user: User, input: CreateSupportCaseDto) =>
  openSupportCase(repository, orderId, user, input)
export const updateSupportCaseById = (caseId: string, user: User, input: UpdateSupportCaseDto) =>
  updateSupportCase(repository, caseId, user, input)
