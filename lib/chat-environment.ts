const DEVELOPMENT_SECRET = 'development-only-chat-tag-secret-change-before-production'
const DEVELOPMENT_CENTRIFUGO_SECRET =
  'development-only-centrifugo-secret-change-before-production'

export const chatEnvironment = {
  databasePath: process.env.CHAT_DB_PATH ?? '.data/chat.sqlite',
  tagHmacSecret: process.env.CHAT_TAG_HMAC_SECRET ?? DEVELOPMENT_SECRET,
  centrifugoApiKey:
    process.env.CENTRIFUGO_API_KEY ?? DEVELOPMENT_CENTRIFUGO_SECRET,
  centrifugoApiUrl:
    process.env.CENTRIFUGO_API_URL ?? 'http://127.0.0.1:8000/api',
  centrifugoTokenHmacSecret:
    process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ?? DEVELOPMENT_CENTRIFUGO_SECRET,
}

export function isChatEnabled(): boolean {
  return process.env.CHAT_ENABLED === 'true'
}

export function getChatRuntimeConfigurationErrors(): string[] {
  if (!isChatEnabled() || process.env.NODE_ENV !== 'production') return []
  const errors: string[] = []
  if (
    !process.env.CHAT_TAG_HMAC_SECRET ||
    process.env.CHAT_TAG_HMAC_SECRET.length < 32
  ) {
    errors.push('CHAT_TAG_HMAC_SECRET must contain at least 32 characters')
  }
  if (
    !process.env.CENTRIFUGO_TOKEN_HMAC_SECRET ||
    process.env.CENTRIFUGO_TOKEN_HMAC_SECRET.length < 32
  ) {
    errors.push('CENTRIFUGO_TOKEN_HMAC_SECRET must contain at least 32 characters')
  }
  if (
    !process.env.CENTRIFUGO_API_KEY ||
    process.env.CENTRIFUGO_API_KEY.length < 32
  ) {
    errors.push('CENTRIFUGO_API_KEY must contain at least 32 characters')
  }
  return errors
}
