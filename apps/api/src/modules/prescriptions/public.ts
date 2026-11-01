import {
  createPrescriptionMessage,
  listPrescriptionMessages,
  readPrescriptionFile,
  reviewPrescription,
  uploadPrescription,
} from './application/prescription.service'
import type { User } from '../../shared/domain/access'
import type {
  PrescriptionMessageRequestDto,
  PrescriptionReviewRequestDto,
} from './application/prescription.dto'
import { PostgresPrescriptionRepository } from './infrastructure/prescription.repository'

const repository = new PostgresPrescriptionRepository()

export const uploadPrescriptionFile = (
  orderId: string,
  actor: User,
  input: Parameters<typeof uploadPrescription>[3],
) => uploadPrescription(repository, orderId, actor, input)
export const getPrescriptionFile = (prescriptionId: string, user: User) =>
  readPrescriptionFile(repository, prescriptionId, user)
export const reviewPrescriptionDocument = (
  prescriptionId: string,
  actor: User,
  input: PrescriptionReviewRequestDto,
) => reviewPrescription(repository, prescriptionId, actor, input)
export const getPrescriptionMessages = (orderId: string, user: User) =>
  listPrescriptionMessages(repository, orderId, user)
export const sendPrescriptionMessage = (
  orderId: string,
  user: User,
  input: PrescriptionMessageRequestDto,
) => createPrescriptionMessage(repository, orderId, user, input)
