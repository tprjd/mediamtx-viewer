import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { test as base, expect } from '@playwright/test'

// Playback and layout checks need Viewing access. Login has separate browser
// coverage; reuse the bootstrap session without writing during registration.
export const test = base.extend({
  page: async ({ page, baseURL }, provide) => {
    const database = new Database(resolve('.data/e2e-auth.sqlite'), { readonly: true })
    const session = database.prepare("SELECT token FROM session WHERE id = 'e2e-layout-session' AND expiresAt > ?").get(Date.now()) as { token: string } | undefined
    database.close()
    if (!session) throw new Error('Bootstrap the browser-test session before running layout checks')
    const signature = createHmac('sha256', 'e2e-better-auth-secret-at-least-32-characters')
      .update(session.token).digest('base64')
    await page.context().addCookies([{
      name: '__Secure-better-auth.session_token',
      value: encodeURIComponent(`${session.token}.${signature}`),
      domain: new URL(baseURL!).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
    }])
    await provide(page)
  },
})

export { expect }
