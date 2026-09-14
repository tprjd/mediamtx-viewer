export interface PublicChatMessage {
  id: string
  submissionId?: string
  sequence: number
  content: string
  profileName: string
  authorTag: string
  badges: Array<'admin' | 'owner'>
  serverTimestamp: string
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
