// @vitest-environment node

import Database from 'better-sqlite3'
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetPasswordAction } from '@/app/reset-password/actions'
import { consumeEmailVerificationToken, requestPasswordRecovery } from '@/lib/auth/email'
import { createPasswordResetToken } from '@/lib/auth/store'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))

let database: Database.Database
let originalHash: string
const now = new Date('2026-10-07T12:00:00.000Z').getTime()
const originalPassword = 'original secure password'
const newPassword = 'replacement secure password'
const sources = ['email', 'administrator'] as const
type Source = typeof sources[number]
const success = { status: 'success', message: 'Password changed. You can sign in now.' }
const invalidLink = { status: 'error', message: 'This reset link is invalid or has expired.' }

beforeAll(async () => {
  originalHash = await hashPassword(originalPassword)
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(`migrations/${name}`, 'utf8'))
  }
  for (const id of ['administrator', 'target', 'other']) {
    database.prepare(`INSERT INTO user
      (id, name, email, emailVerified, username, displayUsername, image, role,
       activationStatus, administratorApproved, legacyAccess, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'active', 1, 1, 0, 0)`)
      .run(id, `${id} name`, `${id}@example.test`, id, id, `${id}.png`, id === 'administrator' ? 'admin' : 'user')
  }
  for (const id of ['target', 'other']) {
    database.prepare(`INSERT INTO account
      (id, issuer, accountId, userId, providerId, password, createdAt, updatedAt)
      VALUES (?, 'local:credential', ?, ?, 'credential', ?, 0, 0)`)
      .run(`${id}-credential`, id, id, originalHash)
    for (const [index, expiresAt] of [now + 86_400_000, now + 172_800_000, now - 1].entries()) {
      database.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 0, 0)`)
        .run(`${id}-session-${index}`, `${id}-session-token-${index}`, id, expiresAt)
    }
    database.prepare(`INSERT INTO channel_stream_key (channel_id, token_hash, token_hint, created_at)
      SELECT id, ?, 'stream-key', 0 FROM channel WHERE owner_user_id = ?`)
      .run(digest(`${id}-stream-key`), id)
  }
  for (const [owner, viewer] of [['target', 'other'], ['other', 'target']]) {
    database.prepare(`INSERT INTO channel_viewing_request
      (id, channel_id, viewer_id, status, created_at, updated_at)
      SELECT ?, id, ?, 'approved', 0, 0 FROM channel WHERE owner_user_id = ?`)
      .run(`${owner}-approval`, viewer, owner)
  }
})

afterEach(() => {
  database.close()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function digest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function emailToken(userId = 'target', purpose: 'verify' | 'reset' = 'reset', token = randomBytes(32).toString('base64url')) {
  database.prepare(`INSERT INTO account_email_token
    (token_hash, user_id, email, purpose, expires_at, created_at)
    SELECT ?, id, email, ?, ?, ? FROM user WHERE id = ?`)
    .run(digest(token), purpose, now + (purpose === 'reset' ? 15 : 60) * 60_000, now, userId)
  return token
}

function administratorToken(userId = 'target', token = randomBytes(32).toString('base64url')) {
  database.prepare(`INSERT INTO auth_reset_token
    (id, token_hash, user_id, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, 'administrator', ?)`)
    .run(randomUUID(), digest(token), userId, now + 15 * 60_000, now)
  return token
}

function resetToken(source: Source, userId = 'target') {
  return source === 'email' ? emailToken(userId) : createPasswordResetToken('administrator', userId)
}

function addProvider(provider: 'google' | 'discord') {
  database.prepare(`INSERT INTO account
    (id, issuer, accountId, userId, providerId, accessToken, refreshToken, scope, createdAt, updatedAt)
    VALUES (?, ?, ?, 'target', ?, 'provider-access-token', 'provider-refresh-token', 'email profile', 0, 0)`)
    .run(`target-${provider}`, `https://${provider}.example.test`, `${provider}-subject`, provider)
}

function form(token: string, password = newPassword, confirmPassword = password) {
  const data = new FormData()
  data.set('token', token)
  data.set('password', password)
  data.set('confirmPassword', confirmPassword)
  return data
}

function reset(token: string, password = newPassword) {
  return resetPasswordAction({ status: 'idle' }, form(token, password))
}

function recoveryState(userId = 'target') {
  return {
    accounts: database.prepare('SELECT * FROM account WHERE userId = ? ORDER BY id').all(userId),
    sessions: database.prepare('SELECT * FROM session WHERE userId = ? ORDER BY id').all(userId),
    emailTokens: database.prepare('SELECT * FROM account_email_token WHERE user_id = ? ORDER BY token_hash').all(userId),
    administratorTokens: database.prepare('SELECT * FROM auth_reset_token WHERE user_id = ? ORDER BY id').all(userId),
  }
}

function identityAndAccess() {
  return {
    users: database.prepare('SELECT * FROM user ORDER BY id').all(),
    channels: database.prepare('SELECT * FROM channel ORDER BY id').all(),
    streamKeys: database.prepare('SELECT * FROM channel_stream_key ORDER BY channel_id').all(),
    channelApprovals: database.prepare('SELECT * FROM channel_viewing_request ORDER BY id').all(),
  }
}

function credential() {
  return database.prepare("SELECT * FROM account WHERE id = 'target-credential'").get() as {
    password: string
    updatedAt: number
  }
}

async function expectPasswordChanged(password = newPassword) {
  expect(await verifyPassword({ hash: credential().password, password })).toBe(true)
  expect(await verifyPassword({ hash: credential().password, password: originalPassword })).toBe(false)
}

describe('Account credentials recovery through the reset form', () => {
  it.each(sources)('completes %s recovery and invalidates all target sessions and reset links', async (source) => {
    if (source === 'administrator') database.exec("UPDATE user SET emailVerified = 0 WHERE id = 'target'")
    addProvider('google')
    addProvider('discord')
    const token = resetToken(source)
    const outstanding = [emailToken(), emailToken(), administratorToken(), administratorToken()]
    const verification = emailToken('target', 'verify')
    emailToken('other')
    administratorToken('other')
    const otherBefore = recoveryState('other')
    const identityBefore = identityAndAccess()
    const providersBefore = database.prepare("SELECT * FROM account WHERE userId = 'target' AND providerId != 'credential' ORDER BY id").all()
    const credentialBefore = credential()
    const verificationBefore = database.prepare('SELECT * FROM account_email_token WHERE token_hash = ?').get(digest(verification))

    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(credential()).toEqual({ ...credentialBefore, password: expect.any(String), updatedAt: now })
    expect(recoveryState().sessions).toEqual([])
    expect(recoveryState().administratorTokens).toEqual([])
    expect(recoveryState().emailTokens).toEqual([verificationBefore])
    expect(recoveryState('other')).toEqual(otherBefore)
    expect(identityAndAccess()).toEqual(identityBefore)
    expect(database.prepare("SELECT * FROM account WHERE userId = 'target' AND providerId != 'credential' ORDER BY id").all()).toEqual(providersBefore)

    const completed = recoveryState()
    for (const usedToken of [token, ...outstanding]) {
      expect(await reset(usedToken, 'another secure password')).toEqual(invalidLink)
    }
    expect(recoveryState()).toEqual(completed)
    expect(recoveryState('other')).toEqual(otherBefore)
  })

  it.each(['pending', 'disabled'])('preserves administrator recovery for an account that is %s', async (status) => {
    database.prepare(`UPDATE user SET activationStatus = ?, emailVerified = 0, banned = 1,
      banReason = 'stored restriction', disabledAt = 123, administratorApproved = 0 WHERE id = 'target'`).run(status)
    database.exec("UPDATE channel SET enabled = 0 WHERE owner_user_id = 'target'")
    const token = resetToken('administrator')
    const before = identityAndAccess()

    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(identityAndAccess()).toEqual(before)
  })

  it('leaves email verification available as a separate operation', async () => {
    database.exec("UPDATE user SET emailVerified = 0 WHERE id = 'target'")
    const verification = emailToken('target', 'verify')
    const token = resetToken('administrator')
    const before = identityAndAccess()

    expect(await reset(token)).toEqual(success)
    expect(identityAndAccess()).toEqual(before)
    expect(consumeEmailVerificationToken(verification)).toBe('target')
    expect(database.prepare("SELECT emailVerified FROM user WHERE id = 'target'").get()).toEqual({ emailVerified: 1 })
    expect(consumeEmailVerificationToken(verification)).toBeNull()
  })

  it.each(sources)('rejects the %s reset link exactly at its expiry deadline', async (source) => {
    const token = resetToken(source)
    const before = recoveryState()
    vi.setSystemTime(now + 15 * 60_000)

    expect(await reset(token)).toEqual(invalidLink)
    expect(recoveryState()).toEqual(before)
  })

  it('rejects an administrator link that was already consumed', async () => {
    const token = resetToken('administrator')
    database.prepare('UPDATE auth_reset_token SET used_at = ? WHERE token_hash = ?').run(now - 1, digest(token))
    const before = recoveryState()

    expect(await reset(token)).toEqual(invalidLink)
    expect(recoveryState()).toEqual(before)
  })

  it('rejects an unknown token without changing stored state', async () => {
    emailToken()
    administratorToken()
    const before = recoveryState()

    expect(await reset(randomBytes(32).toString('base64url'))).toEqual(invalidLink)
    expect(recoveryState()).toEqual(before)
  })

  describe.each(sources)('%s form validation', (source) => {
    it.each([
      ['password', 'x'.repeat(14), 'Too small: expected string to have >=15 characters'],
      ['password', 'x'.repeat(129), 'Too big: expected string to have <=128 characters'],
      ['password', null, 'Invalid input: expected string, received null'],
      ['token', 'x'.repeat(19), 'Too small: expected string to have >=20 characters'],
      ['token', null, 'Invalid input: expected string, received null'],
      ['confirmPassword', 'a different password', 'Passwords do not match.'],
      ['confirmPassword', null, 'Invalid input: expected string, received null'],
    ])('rejects invalid %s value %s without consuming the link', async (field, value, message) => {
      const token = resetToken(source)
      const data = form(token)
      if (value === null) data.delete(field!)
      else data.set(field!, value)
      const before = recoveryState()

      expect(await resetPasswordAction({ status: 'idle' }, data)).toEqual({ status: 'error', message })
      expect(recoveryState()).toEqual(before)
      expect(await reset(token)).toEqual(success)
    })
  })

  it.each([15, 128])('accepts a password with %i characters', async (length) => {
    const password = 'x'.repeat(length)
    expect(await reset(resetToken('administrator'), password)).toEqual(success)
    await expectPasswordChanged(password)
  })

  it.each(['wrong purpose', 'changed email', 'pending account', 'disabled account'])('rejects an email token for %s', async (reason) => {
    const token = emailToken('target', reason === 'wrong purpose' ? 'verify' : 'reset')
    if (reason === 'changed email') database.exec("UPDATE user SET email = 'changed@example.test' WHERE id = 'target'")
    if (reason === 'pending account') database.exec("UPDATE user SET activationStatus = 'pending' WHERE id = 'target'")
    if (reason === 'disabled account') database.exec("UPDATE user SET activationStatus = 'disabled' WHERE id = 'target'")
    const before = recoveryState()
    const identityBefore = identityAndAccess()

    expect(await reset(token)).toEqual(invalidLink)
    expect(recoveryState()).toEqual(before)
    expect(identityAndAccess()).toEqual(identityBefore)
  })

  it('does not add an email verification check when consuming an existing email reset link', async () => {
    const token = emailToken()
    database.exec("UPDATE user SET emailVerified = 0 WHERE id = 'target'")

    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(database.prepare("SELECT emailVerified FROM user WHERE id = 'target'").get()).toEqual({ emailVerified: 0 })
  })

  it('prefers the email reset when the same token exists in both sources', async () => {
    const token = emailToken()
    administratorToken('other', token)
    const otherBefore = recoveryState('other')

    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(recoveryState('other')).toEqual(otherBefore)
  })

  it.each(['wrong purpose', 'changed email', 'expired', 'inactive'])('tries administrator recovery when the email token is rejected for %s', async (reason) => {
    const token = emailToken('other', reason === 'wrong purpose' ? 'verify' : 'reset')
    administratorToken('target', token)
    if (reason === 'changed email') database.exec("UPDATE user SET email = 'changed@example.test' WHERE id = 'other'")
    if (reason === 'expired') database.prepare('UPDATE account_email_token SET expires_at = ?').run(now)
    if (reason === 'inactive') database.exec("UPDATE user SET activationStatus = 'disabled' WHERE id = 'other'")
    const otherBefore = recoveryState('other')

    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(recoveryState('other')).toEqual(otherBefore)
  })

  it.each(['google', 'discord'] as const)('does not issue recovery for a %s-only account', async (provider) => {
    database.exec("DELETE FROM account WHERE id = 'target-credential'")
    addProvider(provider)
    vi.stubEnv('SMTP_HOST', '')
    vi.stubEnv('SMTP_FROM', '')
    const before = recoveryState()

    expect(() => createPasswordResetToken('administrator', 'target')).toThrow('This account uses provider sign-in. Recover access with the provider.')
    await expect(requestPasswordRecovery('target@example.test')).resolves.toBeUndefined()
    expect(recoveryState()).toEqual(before)
    expect(database.prepare('SELECT * FROM auth_audit_log').all()).toEqual([])
    expect(database.prepare('SELECT * FROM account_email_throttle').all()).toEqual([])
  })

  describe.each(sources)('%s token without a matching local credential', (source) => {
    it.each(['absent', 'different issuer', 'different provider'])('preserves token consumption when the credential is %s', async (reason) => {
      const token = resetToken(source)
      const siblingEmail = emailToken()
      const siblingAdministrator = administratorToken()
      const verification = emailToken('target', 'verify')
      addProvider('google')
      if (reason === 'absent') database.exec("DELETE FROM account WHERE id = 'target-credential'")
      if (reason === 'different issuer') database.exec("UPDATE account SET issuer = 'other:credential' WHERE id = 'target-credential'")
      if (reason === 'different provider') database.exec("UPDATE account SET providerId = 'other' WHERE id = 'target-credential'")
      const before = recoveryState()
      const identityBefore = identityAndAccess()

      expect(await reset(token)).toEqual(invalidLink)
      expect(recoveryState().accounts).toEqual(before.accounts)
      expect(recoveryState().sessions).toEqual(before.sessions)
      expect(identityAndAccess()).toEqual(identityBefore)
      expect(database.prepare('SELECT token_hash FROM account_email_token WHERE token_hash = ?').get(digest(verification))).toBeDefined()
      if (source === 'email') {
        expect(database.prepare("SELECT * FROM account_email_token WHERE user_id = 'target' AND purpose = 'reset'").all()).toEqual([])
        expect(recoveryState().administratorTokens).toEqual(before.administratorTokens)
      } else {
        expect(recoveryState().emailTokens).toEqual(before.emailTokens)
        expect(database.prepare('SELECT used_at FROM auth_reset_token WHERE token_hash = ?').get(digest(token))).toEqual({ used_at: now })
        expect(database.prepare('SELECT used_at FROM auth_reset_token WHERE token_hash = ?').get(digest(siblingAdministrator))).toEqual({ used_at: null })
      }
      const failed = recoveryState()
      expect(await reset(token)).toEqual(invalidLink)
      expect(recoveryState()).toEqual(failed)

      // The email path consumes its sibling reset links even when no credential changes.
      if (source === 'email') expect(await reset(siblingEmail)).toEqual(invalidLink)
    })
  })

  it('does not fall back to an administrator token after an email match lacks a local credential', async () => {
    const token = emailToken()
    administratorToken('other', token)
    database.exec("DELETE FROM account WHERE id = 'target-credential'")
    const otherBefore = recoveryState('other')
    const before = recoveryState()

    expect(await reset(token)).toEqual(invalidLink)
    expect(recoveryState().accounts).toEqual(before.accounts)
    expect(recoveryState().sessions).toEqual(before.sessions)
    expect(recoveryState().emailTokens).toEqual([])
    expect(recoveryState('other')).toEqual(otherBefore)
  })

  it.each(sources)('rolls back %s recovery on a storage exception and allows a retry', async (source) => {
    const token = resetToken(source)
    emailToken()
    administratorToken()
    emailToken('target', 'verify')
    const before = recoveryState()
    const identityBefore = identityAndAccess()
    database.exec(`CREATE TEMP TRIGGER reject_reset_cleanup BEFORE DELETE ON auth_reset_token
      BEGIN SELECT RAISE(ABORT, 'storage rejected reset cleanup'); END`)

    await expect(reset(token)).rejects.toThrow('storage rejected reset cleanup')
    expect(recoveryState()).toEqual(before)
    expect(identityAndAccess()).toEqual(identityBefore)
    expect(await verifyPassword({ hash: credential().password, password: originalPassword })).toBe(true)

    database.exec('DROP TRIGGER reject_reset_cleanup')
    expect(await reset(token)).toEqual(success)
    await expectPasswordChanged()
    expect(recoveryState().sessions).toEqual([])
  })
})
