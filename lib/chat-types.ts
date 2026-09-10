export interface PublicChatMessage {
  id: string
  sequence: number
  content: string
  profileName: string
  authorTag: string
  badges: Array<'admin' | 'owner'>
  serverTimestamp: string
}
