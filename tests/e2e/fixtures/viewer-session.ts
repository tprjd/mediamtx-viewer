import { createHmac, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { test as base, expect } from '@playwright/test'

// Playback and layout checks need Viewing access. Login has separate browser
// coverage; seed a session here so parallel checks do not exhaust its rate limit.
export const test = base.extend({
  page: async ({ page, baseURL }, provide) => {
    const database = new Database(resolve('.data/e2e-auth.sqlite'))
    database.pragma('foreign_keys = ON')
    const token = randomUUID()
    const now = Date.now()
    database.prepare(`INSERT INTO session (id, token, userId, expiresAt, createdAt, updatedAt)
      VALUES (?, ?, 'e2e-directory-alpha-user', ?, ?, ?)`)
      .run(randomUUID(), token, now + 3_600_000, now, now)
    const signature = createHmac('sha256', 'e2e-better-auth-secret-at-least-32-characters')
      .update(token).digest('base64')
    try {
      await page.context().addCookies([{
        name: '__Secure-better-auth.session_token',
        value: encodeURIComponent(`${token}.${signature}`),
        domain: new URL(baseURL!).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax',
      }])
      await provide(page)
    } finally {
      database.prepare('DELETE FROM session WHERE token = ?').run(token)
      database.close()
    }
  },
})

export { expect }
