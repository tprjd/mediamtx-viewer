import { APIError, betterAuth } from 'better-auth'
import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, username } from 'better-auth/plugins'

import { getDatabase } from '@/lib/auth/database'
import { authEnvironment } from '@/lib/auth/env'
import { getRegistrationOpen, getUserStatus } from '@/lib/auth/store'
import { socialProviders, validateProviderUser } from '@/lib/auth/oauth'
import { disconnectProvider } from '@/lib/auth/sign-in-methods'

export const auth = betterAuth({
  appName: 'Home Stream',
  baseURL: authEnvironment.baseUrl,
  secret: authEnvironment.secret,
  database: getDatabase(),
  trustedOrigins: authEnvironment.trustedOrigins,
  socialProviders: socialProviders(),
  onAPIError: { errorURL: '/login' },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
      // Existing password accounts have no email verification flow. The
      // validateUserInfo policy permits implicit linking only for Google-owned
      // verified email. Better Auth 1.7.2 otherwise rejects these legacy users.
      requireLocalEmailVerified: false,
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 15,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      username: null,
      displayUsername: null,
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      ...additionalFields,
      id,
    }),
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  user: {
    validateUserInfo: validateProviderUser,
    additionalFields: {
      activationStatus: {
        type: 'string',
        required: true,
        defaultValue: 'pending',
        input: false,
      },
      activatedAt: { type: 'date', required: false, input: false },
      activatedBy: { type: 'string', required: false, input: false },
      disabledAt: { type: 'date', required: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/username': { window: 60, max: 8 },
      '/sign-up/email': { window: 60 * 10, max: 5 },
      '/reset-password': { window: 60 * 10, max: 5 },
    },
  },
  advanced: {
    disableOriginCheck: false,
    useSecureCookies: process.env.NODE_ENV === 'production',
    ipAddress: {
      trustedProxies: ['127.0.0.1/32', '172.28.0.0/24'],
    },
    database: { joins: true },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if ((context.path === '/sign-in/social' || context.path === '/link-social') && context.body?.idToken) {
        throw APIError.from('BAD_REQUEST', {
          code: 'OAUTH_REDIRECT_REQUIRED',
          message: 'Use the provider redirect to sign in or link an account.',
        })
      }
      if (context.path === '/link-social' || context.path === '/unlink-account') {
        const session = await getSessionFromCtx(context, { disableRefresh: true })
        if (!session || getUserStatus(session.user.id) !== 'active') {
          throw APIError.from('UNAUTHORIZED', { code: 'LINK_SESSION_REQUIRED', message: 'Sign in again to manage providers.' })
        }
        if (context.path === '/unlink-account') {
          if (Date.now() - new Date(session.session.createdAt).getTime() >= context.context.sessionConfig.freshAge * 1000) {
            throw APIError.from('FORBIDDEN', { code: 'SESSION_NOT_FRESH', message: 'Sign in again before disconnecting a provider.' })
          }
          if (typeof context.body?.accountId !== 'string') {
            throw APIError.from('BAD_REQUEST', { code: 'ACCOUNT_NOT_FOUND', message: 'Provider account not found.' })
          }
          return context.json(disconnectProvider(session.user.id, context.body.accountId))
        }
      }
      if (
        context.path === '/sign-up/email' &&
        process.env.ALLOW_ADMIN_BOOTSTRAP !== 'true' &&
        !getRegistrationOpen()
      ) {
        throw APIError.from('FORBIDDEN', {
          code: 'REGISTRATION_CLOSED',
          message: 'Registration is currently closed.',
        })
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        async before(session) {
          const status = getUserStatus(session.userId)
          if (status !== 'active') {
            throw APIError.from('FORBIDDEN', {
              code: status === 'disabled' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_PENDING',
              message:
                status === 'disabled'
                  ? 'This account is disabled.'
                  : 'Your account is waiting for approval.',
            })
          }
        },
      },
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
      usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/.test(value),
    }),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
      bannedUserMessage: 'This account is disabled.',
    }),
  ],
})

export type Session = typeof auth.$Infer.Session
