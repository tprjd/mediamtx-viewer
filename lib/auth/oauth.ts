import type { BetterAuthOptions } from 'better-auth'
import { getOAuthState, getSessionFromCtx } from 'better-auth/api'
import { google, verifyGoogleIdToken } from 'better-auth/social-providers'

import { getRegistrationOpen, getUserStatus } from './store'

export type OAuthProvider = 'google' | 'discord'

export function configuredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = []
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) providers.push('google')
  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) providers.push('discord')
  return providers
}

export function socialProviders(): BetterAuthOptions['socialProviders'] {
  const enabled = configuredProviders()
  const googleClientId = process.env.GOOGLE_CLIENT_ID!
  return {
    ...(enabled.includes('google') ? {
      google: {
        clientId: googleClientId,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        prompt: 'select_account',
        async getUserInfo(tokens) {
          if (!tokens.idToken) return null
          // The linking policy uses these claims, so verify them before inspection.
          const profile = await verifyGoogleIdToken({ token: tokens.idToken, audience: googleClientId })
          if (!profile || typeof profile.sub !== 'string') return null
          return google({
            clientId: googleClientId,
            mapProfileToUser: () => ({
              name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 80) : 'Google user',
              emailVerified: profile.email_verified === true,
            }),
          }).getUserInfo(tokens)
        },
      },
    } : {}),
    ...(enabled.includes('discord') ? {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID!,
        clientSecret: process.env.DISCORD_CLIENT_SECRET!,
        prompt: 'consent',
        mapProfileToUser: (profile) => ({ name: (profile.global_name || profile.username || 'Discord user').slice(0, 80) }),
      },
    } : {}),
  }
}

export const validateProviderUser: NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']> = async ({ user, source }, context) => {
  if (source.method !== 'oauth') return
  if (!user.email || user.emailVerified !== true) return { error: 'PROVIDER_EMAIL_NOT_VERIFIED' }

  if (source.action === 'create-user') {
    if (!getRegistrationOpen()) return { error: 'REGISTRATION_CLOSED' }
    return
  }

  if (source.action === 'link-account') {
    const link = (await getOAuthState())?.link
    if (link) {
      const session = await getSessionFromCtx(context, { disableRefresh: true })
      if (!session || session.user.id !== link.userId || getUserStatus(link.userId) !== 'active') {
        return { error: 'LINK_SESSION_REQUIRED' }
      }
      return
    }

    const profile = source.oauth?.profile
    const googleOwnsEmail = source.oauth?.providerId === 'google'
      && profile?.email_verified === true
      && typeof profile.email === 'string'
      && (profile.email.toLowerCase().endsWith('@gmail.com') || (typeof profile.hd === 'string' && profile.hd.length > 0))
    if (!googleOwnsEmail) return { error: 'MANUAL_LINK_REQUIRED' }
  }
}
