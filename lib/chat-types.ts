interface ChatMessageIdentity {
  id: string
  sequence: number
  serverTimestamp: string
  revisionSequence?: number
}

export interface ChatTombstone extends ChatMessageIdentity {
  removed: true
  revisionSequence: number
  submissionId?: never
  content?: never
  profileName?: never
  authorTag?: never
  badges?: never
}

export interface ChatContentMessage extends ChatMessageIdentity {
  removed?: false
  submissionId?: string
  content: string
  profileName: string
  authorTag: string
  badges: Array<'admin' | 'owner'>
}

export interface ChatHistoryPage {
  messages: PublicChatMessage[]
  hasMore: boolean
  cursor: string | null
}

export interface PublicChatMessageEvent {
  type: 'message'
  eventId: string
  message: PublicChatMessage
}

export type PublicChatMessage = ChatContentMessage | ChatTombstone
export type ChatModeratorRole = 'admin' | 'owner' | null

export interface ChatRestriction {
  category: 'Spam' | 'Harassment' | 'Other'
  expiresAt: string
}

export interface ChatParticipantState {
  channelId: string
  restriction: ChatRestriction | null
  moderatorRole: ChatModeratorRole
  serverTime: string
}
