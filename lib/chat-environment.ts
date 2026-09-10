const DEVELOPMENT_SECRET = 'development-only-chat-tag-secret-change-before-production'

export const chatEnvironment = {
  databasePath: process.env.CHAT_DB_PATH ?? '.data/chat.sqlite',
  tagHmacSecret: process.env.CHAT_TAG_HMAC_SECRET ?? DEVELOPMENT_SECRET,
}

export function isChatEnabled(): boolean {
  return process.env.CHAT_ENABLED === 'true'
}

export function getChatRuntimeConfigurationErrors(): string[] {
  if (!isChatEnabled() || process.env.NODE_ENV !== 'production') return []
  if (
    !process.env.CHAT_TAG_HMAC_SECRET ||
    process.env.CHAT_TAG_HMAC_SECRET.length < 32
  ) {
    return ['CHAT_TAG_HMAC_SECRET must contain at least 32 characters']
  }
  return []
}
