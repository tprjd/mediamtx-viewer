import { APIError, betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { admin, username } from 'better-auth/plugins'

import { getDatabase } from '@/lib/auth/database'
import { authEnvironment } from '@/lib/auth/env'
import { getRegistrationOpen, getUserStatus } from '@/lib/auth/store'

export const auth = betterAuth({
  appName: 'Home Stream',
  baseURL: authEnvironment.baseUrl,
  secret: authEnvironment.secret,
  database: getDatabase(),
  trustedOrigins: [authEnvironment.baseUrl],
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
    useSecureCookies: process.env.NODE_ENV === 'production',
    ipAddress: {
      trustedProxies: ['127.0.0.1/32', '172.28.0.0/24'],
    },
    database: { joins: true },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
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

