// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = mkdtempSync(join(tmpdir(), 'viewer-oauth-'))
const origin = 'http://localhost:3000'
process.env.AUTH_DB_PATH = join(directory, 'auth.sqlite')
process.env.BETTER_AUTH_URL = origin
process.env.BETTER_AUTH_SECRET = 'oauth-test-secret-at-least-32-characters'
process.env.GOOGLE_CLIENT_ID = 'google-test-client'
process.env.GOOGLE_CLIENT_SECRET = 'google-test-secret'
process.env.DISCORD_CLIENT_ID = 'discord-test-client'
process.env.DISCORD_CLIENT_SECRET = 'discord-test-secret'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
let profile: Record<string, unknown> = {}

function idToken(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
    ...profile, ...overrides,
  })).toString('base64url')
  const input = `${header}.${payload}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
}

async function request(path: string, body?: unknown, cookie = '') {
  const { auth } = await import('./auth')
  return auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

async function localAccount(email: string, status = 'active') {
  const { getDatabase } = await import('./database')
  const id = randomUUID()
  const now = Date.now()
  getDatabase().prepare(`INSERT INTO user
    (id, name, email, emailVerified, createdAt, updatedAt, role, banned, activationStatus)
    VALUES (?, 'Existing name', ?, 0, ?, ?, 'user', 0, ?)`)
    .run(id, email, now, now, status)
  return id
}

async function sessionCookie(userId: string, createdAt = Date.now()) {
  const { getDatabase } = await import('./database')
  const token = randomUUID()
  getDatabase().prepare(`INSERT INTO session
    (id, token, userId, createdAt, updatedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), token, userId, createdAt, Date.now(), Date.now() + 86_400_000)
  const signature = createHmac('sha256', process.env.BETTER_AUTH_SECRET!).update(token).digest('base64')
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`
}

async function begin(provider: 'google' | 'discord', cookie = '', link = false) {
  const response = await request(link ? '/link-social' : '/sign-in/social', {
    provider, callbackURL: '/account', errorCallbackURL: '/login', disableRedirect: true,
  }, cookie)
  expect(response.status).toBe(200)
  const { url } = await response.json()
  return { state: new URL(url).searchParams.get('state'), cookie: [cookie, cookies(response)].filter(Boolean).join('; ') }
}

async function callback(provider: 'google' | 'discord', flow: Awaited<ReturnType<typeof begin>>) {
  return request(`/callback/${provider}?state=${flow.state}&code=test-code`, undefined, flow.cookie)
}

function callbackError(response: Response) {
  return new URL(response.headers.get('location')!, origin).searchParams.get('error')
}

describe('provider sign-in and account linking', () => {
  beforeEach(async () => {
    const { getDatabase } = await import('./database')
    getDatabase().prepare('DELETE FROM rateLimit').run()
  })
  beforeAll(async () => {
    const { getDatabase } = await import('./database')
    for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
      getDatabase().exec(readFileSync(join('migrations', file), 'utf8'))
    }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'google-access', token_type: 'Bearer', expires_in: 3600, id_token: idToken() })
      }
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] })
      }
      if (url === 'https://discord.com/api/oauth2/token') {
        return Response.json({ access_token: 'discord-access', token_type: 'Bearer', expires_in: 3600 })
      }
      if (decodeURIComponent(url) === 'https://discord.com/api/users/@me') {
        return Response.json({ id: '123456789012345678', username: 'Discord name', discriminator: '0', avatar: null, ...profile })
      }
      throw new Error(`Unexpected provider request: ${url}`)
    }))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    const { getDatabase } = await import('./database')
    getDatabase().close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('automatically links verified Gmail to an existing unverified site account', async () => {
    const userId = await localAccount('existing@gmail.com')
    profile = { sub: 'gmail-existing', email: 'existing@gmail.com', email_verified: true, name: 'Google name' }
    const response = await callback('google', await begin('google'))
    expect(response.headers.get('location')).toBe('/account')
    const session = await request('/get-session', undefined, cookies(response))
    expect(await session.json()).toMatchObject({ user: { id: userId, name: 'Existing name', email: 'existing@gmail.com' } })
    const accounts = await request('/list-accounts', undefined, cookies(response))
    expect(await accounts.json()).toEqual([expect.objectContaining({ providerId: 'google', userId })])
  })

  it('rejects direct ID-token linking so it cannot bypass the callback policy', async () => {
    const userId = await localAccount('direct@example.com')
    profile = { sub: 'direct-google', email: 'other@gmail.com', email_verified: true, name: 'Google name' }
    const response = await request('/link-social', { provider: 'google', idToken: { token: idToken() } }, await sessionCookie(userId))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'OAUTH_REDIRECT_REQUIRED' })
  })

  it('keeps one usable provider when disconnect requests arrive together', async () => {
    const userId = await localAccount('disconnect@example.com')
    const cookie = await sessionCookie(userId)
    profile = { sub: 'disconnect-google', email: 'different@gmail.com', email_verified: true, name: 'Google name' }
    expect((await callback('google', await begin('google', cookie, true))).headers.get('location')).toBe('/account')
    profile = { id: '123456789012345679', email: 'different@discord.example', verified: true }
    expect((await callback('discord', await begin('discord', cookie, true))).headers.get('location')).toBe('/account')
    const accounts: { id: string }[] = await (await request('/list-accounts', undefined, cookie)).json()
    const responses = await Promise.all(accounts.map(({ id }) => request('/unlink-account', { accountId: id }, cookie)))
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
    expect(await (await request('/list-accounts', undefined, cookie)).json()).toHaveLength(1)
  })

  it('does not count a provider with missing configuration as a usable alternative', async () => {
    const userId = await localAccount('disabled-provider@example.com')
    const cookie = await sessionCookie(userId)
    profile = { sub: 'disabled-provider-google', email: 'disabled-provider@gmail.com', email_verified: true }
    await callback('google', await begin('google', cookie, true))
    profile = { id: '123456789012345680', email: 'disabled-provider@discord.example', verified: true }
    await callback('discord', await begin('discord', cookie, true))
    const accounts: { id: string; providerId: string }[] = await (await request('/list-accounts', undefined, cookie)).json()
    const googleAccount = accounts.find((account) => account.providerId === 'google')!
    const discordSecret = process.env.DISCORD_CLIENT_SECRET
    delete process.env.DISCORD_CLIENT_SECRET
    try {
      const response = await request('/unlink-account', { accountId: googleAccount.id }, cookie)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' })
    } finally {
      process.env.DISCORD_CLIENT_SECRET = discordSecret
    }
  })

  it('automatically links verified Workspace email using the hosted-domain claim', async () => {
    const userId = await localAccount('member@workspace.example')
    profile = { sub: 'workspace-member', email: 'member@workspace.example', email_verified: true, hd: 'workspace.example' }
    const response = await callback('google', await begin('google'))
    expect(await (await request('/get-session', undefined, cookies(response))).json()).toMatchObject({ user: { id: userId } })
  })

  it.each(['google', 'discord'] as const)('requires manual linking for a matching external email from %s', async (provider) => {
    const email = `manual-${provider}@example.com`
    const userId = await localAccount(email)
    profile = { sub: 'manual-external', email, email_verified: true, verified: true }
    const response = await callback(provider, await begin(provider))
    expect(callbackError(response)).toBe('MANUAL_LINK_REQUIRED')
    expect(await (await request('/list-accounts', undefined, await sessionCookie(userId))).json()).toEqual([])
  })

  it.each(['google', 'discord'] as const)('registers a pending %s account without a username or password, then permits sign-in after approval', async (provider) => {
    const { setRegistrationOpen, listUsers, activateUser } = await import('./store')
    const admin = await localAccount(`registration-admin-${provider}@example.com`)
    setRegistrationOpen(admin, true)
    const email = `new-${provider}@example.com`
    profile = { sub: 'new-google', id: '223456789012345678', email, email_verified: true, verified: true, name: 'New user' }
    const response = await callback(provider, await begin(provider))
    expect(callbackError(response)).toBe('ACCOUNT_PENDING')
    expect(await (await request('/get-session', undefined, cookies(response))).json()).toBeNull()
    const user = listUsers().find((candidate) => candidate.email === email)!
    expect(user).toMatchObject({ username: null, activationStatus: 'pending' })
    activateUser(admin, user.id)
    setRegistrationOpen(admin, false)
    const approved = await callback(provider, await begin(provider))
    expect(await (await request('/get-session', undefined, cookies(approved))).json()).toMatchObject({ user: { id: user.id, activationStatus: 'active' } })
    expect(await (await request('/list-accounts', undefined, cookies(approved))).json()).toEqual([expect.objectContaining({ providerId: provider })])
  })

  it('checks registration again when the provider returns', async () => {
    const { setRegistrationOpen, listUsers } = await import('./store')
    const admin = await localAccount('closing-admin@example.com')
    setRegistrationOpen(admin, true)
    const flow = await begin('google')
    setRegistrationOpen(admin, false)
    profile = { sub: 'closed-registration', email: 'closed@gmail.com', email_verified: true }
    expect(callbackError(await callback('google', flow))).toBe('REGISTRATION_CLOSED')
    expect(listUsers().find((candidate) => candidate.email === profile.email)).toBeUndefined()
  })

  it.each(['pending', 'disabled'])('does not issue a provider session to a %s account', async (status) => {
    await localAccount(`${status}@gmail.com`, status)
    profile = { sub: `google-${status}`, email: `${status}@gmail.com`, email_verified: true }
    const response = await callback('google', await begin('google'))
    expect(callbackError(response)).toBe(status === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_DISABLED')
    expect(await (await request('/get-session', undefined, cookies(response))).json()).toBeNull()
  })

  it('keeps site email and profile when manually linking a different provider email', async () => {
    const { getUserById } = await import('./store')
    const userId = await localAccount('keep-site-email@example.com')
    const cookie = await sessionCookie(userId)
    profile = { id: '323456789012345678', email: 'other-mail@example.com', verified: true, global_name: 'Different name' }
    const response = await callback('discord', await begin('discord', cookie, true))
    expect(response.headers.get('location')).toBe('/account')
    expect(getUserById(userId)).toMatchObject({ email: 'keep-site-email@example.com', name: 'Existing name' })
    const signedIn = await callback('discord', await begin('discord'))
    expect(await (await request('/get-session', undefined, cookies(signedIn))).json()).toMatchObject({ user: { id: userId, email: 'keep-site-email@example.com' } })
  })

  it('refuses a provider identity already linked to another site account', async () => {
    const first = await localAccount('first-owner@example.com')
    const second = await localAccount('second-owner@example.com')
    profile = { sub: 'shared-provider', email: 'shared-provider@gmail.com', email_verified: true }
    await callback('google', await begin('google', await sessionCookie(first), true))
    const cookie = await sessionCookie(second)
    expect(callbackError(await callback('google', await begin('google', cookie, true)))).toBe('account_already_linked_to_different_user')
    expect(await (await request('/list-accounts', undefined, cookie)).json()).toEqual([])
  })

  it('requires the same active site session when manual linking returns', async () => {
    const userId = await localAccount('expired-link@example.com')
    const flow = await begin('discord', await sessionCookie(userId), true)
    profile = { id: '423456789012345678', email: 'expired-link-discord@example.com', verified: true }
    flow.cookie = flow.cookie.split('; ').filter((part) => !part.startsWith('better-auth.session_token=')).join('; ')
    expect(callbackError(await callback('discord', flow))).toBe('LINK_SESSION_REQUIRED')
  })

  it.each(['google', 'discord'] as const)('rejects unverified %s email during registration', async (provider) => {
    const { setRegistrationOpen, listUsers } = await import('./store')
    const admin = await localAccount(`unverified-admin-${provider}@example.com`)
    setRegistrationOpen(admin, true)
    profile = { sub: 'unverified-google', id: '523456789012345678', email: `unverified-${provider}@gmail.com`, email_verified: false, verified: false }
    expect(callbackError(await callback(provider, await begin(provider)))).toBe('PROVIDER_EMAIL_NOT_VERIFIED')
    expect(listUsers().find((candidate) => candidate.email === profile.email)).toBeUndefined()
    setRegistrationOpen(admin, false)
  })

  it('rejects a Google token issued for another client', async () => {
    profile = { sub: 'invalid-audience', email: 'existing@gmail.com', email_verified: true, aud: 'another-client' }
    expect(callbackError(await callback('google', await begin('google')))).toBe('unable_to_get_user_info')
  })

  it('rejects a callback without the state cookie', async () => {
    profile = { sub: 'missing-state', email: 'existing@gmail.com', email_verified: true }
    const flow = await begin('google')
    expect(callbackError(await callback('google', { ...flow, cookie: '' }))).toBe('state_mismatch')
  })

  it('rejects disconnect from another origin', async () => {
    const { auth } = await import('./auth')
    const userId = await localAccount('cross-origin@example.com')
    const response = await auth.handler(new Request(`${origin}/api/auth/unlink-account`, {
      method: 'POST', headers: { origin: 'https://attacker.example', cookie: await sessionCookie(userId), 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: 'anything' }),
    }))
    expect(response.status).toBe(403)
  })

  it('preserves account credentials after automatic linking and permits provider disconnect', async () => {
    const { setRegistrationOpen, listUsers, activateUser } = await import('./store')
    const admin = await localAccount('credentials-admin@example.com')
    setRegistrationOpen(admin, true)
    const credentials = { username: 'retained_credentials', password: 'a long retained password' }
    expect((await request('/sign-up/email', { ...credentials, name: 'Retained name', email: 'credentials@gmail.com' })).status).toBe(200)
    const user = listUsers().find((candidate) => candidate.email === 'credentials@gmail.com')!
    activateUser(admin, user.id)
    setRegistrationOpen(admin, false)
    profile = { sub: 'retained-credentials-google', email: 'credentials@gmail.com', email_verified: true, name: 'Other name' }
    const response = await callback('google', await begin('google'))
    const cookie = cookies(response)
    const accounts: { id: string; providerId: string }[] = await (await request('/list-accounts', undefined, cookie)).json()
    expect(accounts.map((account) => account.providerId).sort()).toEqual(['credential', 'google'])
    const removed = await request('/unlink-account', { accountId: accounts.find((account) => account.providerId === 'google')!.id }, cookie)
    expect(removed.status).toBe(200)
    const passwordSignIn = await request('/sign-in/username', credentials)
    expect(passwordSignIn.status).toBe(200)
    expect(await passwordSignIn.json()).toMatchObject({ user: { id: user.id, name: 'Retained name', email: 'credentials@gmail.com' } })
  })

  it('rejects disconnect from an old session', async () => {
    const userId = await localAccount('old-session@example.com')
    const response = await request('/unlink-account', { accountId: 'anything' }, await sessionCookie(userId, Date.now() - 2 * 86_400_000))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'SESSION_NOT_FRESH' })
  })

  it('rejects provider management for an account disabled after session creation', async () => {
    const { disableUser } = await import('./store')
    const admin = await localAccount('disable-admin@example.com')
    const userId = await localAccount('disabled-link@example.com')
    const cookie = await sessionCookie(userId)
    const flow = await begin('google', cookie, true)
    disableUser(admin, userId)
    profile = { sub: 'disabled-link-google', email: 'disabled-link@gmail.com', email_verified: true }
    expect(callbackError(await callback('google', flow))).toBe('LINK_SESSION_REQUIRED')
    expect((await request('/link-social', { provider: 'google' }, cookie)).status).toBe(401)
    expect((await request('/unlink-account', { accountId: 'anything' }, cookie)).status).toBe(401)
  })

  it('rejects a callback replay', async () => {
    profile = { sub: 'gmail-existing', email: 'existing@gmail.com', email_verified: true }
    const flow = await begin('google')
    expect((await callback('google', flow)).headers.get('location')).toBe('/account')
    expect(callbackError(await callback('google', flow))).toBe('state_mismatch')
  })

  it('rejects Discord registration when no email is returned', async () => {
    profile = { id: '623456789012345678', email: null, verified: false }
    expect(callbackError(await callback('discord', await begin('discord')))).toBe('email_not_found')
  })

  it('continues to resolve a linked provider identity after its email changes', async () => {
    profile = { sub: 'gmail-existing', email: 'changed@example.com', email_verified: true }
    const response = await callback('google', await begin('google'))
    expect(await (await request('/get-session', undefined, cookies(response))).json()).toMatchObject({ user: { email: 'existing@gmail.com' } })
  })

  it('rejects a client attempt to forge a manual-link flow', async () => {
    const userId = await localAccount('spoofed-link@example.com')
    profile = { id: '723456789012345678', email: 'spoofed-link@example.com', verified: true }
    const response = await request('/sign-in/social', {
      provider: 'discord', callbackURL: '/account', errorCallbackURL: '/login', disableRedirect: true,
      additionalData: { link: { userId, email: profile.email } },
    }, await sessionCookie(userId))
    const { url } = await response.json()
    expect(callbackError(await callback('discord', { state: new URL(url).searchParams.get('state'), cookie: cookies(response) }))).toBe('MANUAL_LINK_REQUIRED')
  })
})
