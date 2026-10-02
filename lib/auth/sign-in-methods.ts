import { APIError } from 'better-auth'

import { getDatabase } from './database'
import { configuredProviders, type OAuthProvider } from './oauth'
import { getUserStatus, recordAudit } from './store'

interface AccountMethod {
  id: string
  providerId: string
  hasPassword: number
  username: string | null
}

export function getSignInMethods(userId: string) {
  const configured = configuredProviders()
  const accounts = getDatabase().prepare(`
    SELECT a.id, a.providerId, (a.password IS NOT NULL AND a.password != '') AS hasPassword, u.username
    FROM account a JOIN user u ON u.id = a.userId WHERE a.userId = ?
  `).all(userId) as AccountMethod[]
  const hasPassword = accounts.some((account) => account.providerId === 'credential' && account.hasPassword === 1)
  const usableIds = accounts.filter((account) => account.providerId === 'credential'
    ? account.hasPassword === 1 && Boolean(account.username)
    : configured.some((provider) => provider === account.providerId)).map((account) => account.id)
  const providers = accounts.flatMap((account) => {
    if (account.providerId !== 'google' && account.providerId !== 'discord') return []
    return [{ id: account.id, provider: account.providerId as OAuthProvider, canDisconnect: usableIds.some((id) => id !== account.id) }]
  })
  return { hasPassword, providers, configured }
}

/** Keep the check and deletion in one SQLite write transaction across workers. */
export function disconnectProvider(userId: string, accountId: string) {
  return getDatabase().transaction(() => {
    if (getUserStatus(userId) !== 'active') {
      throw APIError.from('FORBIDDEN', { code: 'ACCOUNT_DISABLED', message: 'This account is not active.' })
    }
    const account = getSignInMethods(userId).providers.find((provider) => provider.id === accountId)
    if (!account) throw APIError.from('BAD_REQUEST', { code: 'ACCOUNT_NOT_FOUND', message: 'Provider account not found.' })
    if (!account.canDisconnect) {
      throw APIError.from('BAD_REQUEST', {
        code: 'FAILED_TO_UNLINK_LAST_ACCOUNT',
        message: 'Keep at least one usable sign-in method.',
      })
    }
    getDatabase().prepare('DELETE FROM account WHERE id = ? AND userId = ?').run(accountId, userId)
    recordAudit(userId, userId, 'provider_disconnected', { provider: account.provider })
    return { status: true }
  }).immediate()
}
