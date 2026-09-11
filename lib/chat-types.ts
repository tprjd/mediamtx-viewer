export interface PublicChatMessage {
  id: string
  sequence: number
  content: string
  profileName: string
  authorTag: string
  badges: Array<'admin' | 'owner'>
  serverTimestamp: string
}

export interface PublicChatMessageEvent {
  type: 'message'
  eventId: string
  message: PublicChatMessage
}
