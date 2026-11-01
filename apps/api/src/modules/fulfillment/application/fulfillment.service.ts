import type { User } from '../../../shared/domain/access'
import { ApplicationError } from '../../../shared/application-error'
import type { FulfillmentCheckRequestDto, FulfillmentCommandRequestDto } from './fulfillment.dto'

export class FulfillmentOperationError extends ApplicationError {}

export interface FulfillmentRepository {
  executeCommand(
    orderId: string,
    actor: User,
    input: FulfillmentCommandRequestDto,
  ): Promise<unknown>
  createCheck(orderId: string, actor: User, input: FulfillmentCheckRequestDto): Promise<unknown>
  createShipmentBooking(orderId: string, actor: User): Promise<never>
}

export function executeFulfillmentCommand(
  repository: FulfillmentRepository,
  orderId: string,
  actor: User,
  input: FulfillmentCommandRequestDto,
) {
  return repository.executeCommand(orderId, actor, input)
}

export function createFulfillmentCheck(
  repository: FulfillmentRepository,
  orderId: string,
  actor: User,
  input: FulfillmentCheckRequestDto,
) {
  return repository.createCheck(orderId, actor, input)
}

export function createShipmentBooking(
  repository: FulfillmentRepository,
  orderId: string,
  actor: User,
) {
  return repository.createShipmentBooking(orderId, actor)
}
