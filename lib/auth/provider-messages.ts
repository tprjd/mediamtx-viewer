export const providerNames = { google: 'Google', discord: 'Discord' } as const

const messages: Record<string, string> = {
  ACCOUNT_PENDING: 'Your account is waiting for administrator approval. Sign in again after approval.',
  ACCOUNT_DISABLED: 'This account is disabled.',
  BANNED_USER: 'This account is disabled.',
  REGISTRATION_CLOSED: 'Registration is closed. Ask the administrator to open it.',
  MANUAL_LINK_REQUIRED: 'Sign in with your existing method, then link this provider in Account settings.',
  account_not_linked: 'Sign in with your existing method, then link this provider in Account settings.',
  PROVIDER_EMAIL_NOT_VERIFIED: 'Verify your email with the provider, then try again.',
  email_not_found: 'The provider did not return an email address. Check your provider account and try again.',
  LINK_SESSION_REQUIRED: 'Sign in again, then link the provider in Account settings.',
  SESSION_NOT_FRESH: 'Sign out and sign in again before disconnecting a provider.',
  FAILED_TO_UNLINK_LAST_ACCOUNT: 'Link another sign-in method before disconnecting this provider.',
  account_already_linked_to_different_user: 'This provider is already linked to another site account.',
  access_denied: 'Provider sign-in was cancelled. You can try again.',
  state_mismatch: 'The sign-in request expired or came from another browser. Try again.',
  state_not_found: 'The sign-in request expired. Try again.',
}

export function providerErrorMessage(code?: string) {
  return code && Object.hasOwn(messages, code) ? messages[code] : 'Could not connect to the provider. Try again.'
}
