export const activationStatuses = ['pending', 'active', 'disabled'] as const

export type ActivationStatus = (typeof activationStatuses)[number]

export interface AuthUser {
  id: string
  name: string
  email: string
  username: string | null
  role: string
  activationStatus: ActivationStatus
  createdAt: Date
  activatedAt: Date | null
  disabledAt: Date | null
}

export interface AuthSessionView {
  id: string
  createdAt: Date
  expiresAt: Date
  userAgent: string | null
}

export interface AuditEntry {
  id: string
  action: string
  actorName: string
  targetName: string | null
  createdAt: Date
}

