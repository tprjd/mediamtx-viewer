import 'server-only'

import type Database from 'better-sqlite3'
import { hashPassword } from 'better-auth/crypto'
import { createHash } from 'node:crypto'

import { getDatabase } from '@/lib/auth/database'

function consumeResetToken(database: Database.Database, token: string): string | null {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const emailToken = database.prepare(`
    SELECT t.user_id AS userId FROM account_email_token t JOIN user u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.purpose = 'reset' AND t.expires_at > ?
      AND t.email = u.email AND u.activationStatus = 'active'
  `).get(tokenHash, Date.now()) as { userId: string } | undefined
  if (emailToken) {
    database.prepare("DELETE FROM account_email_token WHERE user_id = ? AND purpose = 'reset'")
      .run(emailToken.userId)
    return emailToken.userId
  }

  const administratorToken = database.prepare(`
    SELECT id, user_id AS userId FROM auth_reset_token
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(tokenHash, Date.now()) as { id: string; userId: string } | undefined
  if (!administratorToken) return null
  database.prepare('UPDATE auth_reset_token SET used_at = ? WHERE id = ?')
    .run(Date.now(), administratorToken.id)
  return administratorToken.userId
}

export async function completePasswordReset(token: string, password: string): Promise<boolean> {
  // Hash before the synchronous transaction so no database write waits for hashing.
  const passwordHash = await hashPassword(password)
  const database = getDatabase()
  return database.transaction(() => {
    const userId = consumeResetToken(database, token)
    if (!userId) return false
    const result = database.prepare(`
      UPDATE account SET password = ?, updatedAt = ?
      WHERE userId = ? AND providerId = 'credential' AND issuer = 'local:credential'
    `).run(passwordHash, Date.now(), userId)
    // Preserve consumption when a valid token has no matching local credential.
    if (!result.changes) return false
    database.prepare('DELETE FROM session WHERE userId = ?').run(userId)
    database.prepare('DELETE FROM auth_reset_token WHERE user_id = ?').run(userId)
    database.prepare("DELETE FROM account_email_token WHERE user_id = ? AND purpose = 'reset'").run(userId)
    return true
  })()
}
