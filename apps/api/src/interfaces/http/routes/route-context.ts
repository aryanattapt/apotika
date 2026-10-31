import type { User } from '../../../shared/api'

export type PublicRouteContext = {
  request: Request
  url: URL
  path: string
  method: string
  requestId: string
  user: User | null
}

export type AuthenticatedRouteContext = Omit<PublicRouteContext, 'user'> & {
  user: User
  currentUser: User
}
