import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import { getDatabase } from '@/lib/auth/database'
import { authEnvironment } from '@/lib/auth/env'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function claimDelivery(key: string, delay: number): boolean {
  const database = getDatabase()
  return database.transaction(() => {
    const now = Date.now()
    const previous = database.prepare('SELECT sent_at AS sentAt FROM account_email_throttle WHERE key = ?').get(key) as { sentAt: number } | undefined
    if (previous && now - previous.sentAt < delay) return false
    database.prepare('INSERT INTO account_email_throttle (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET sent_at = excluded.sent_at').run(key, now)
    database.prepare('DELETE FROM account_email_throttle WHERE sent_at < ?').run(now - 86_400_000)
    return true
  }).immediate()
}

export function allowRecoveryRequest(address: string): boolean {
  return claimDelivery(`ip:${digest(address)}`, 10_000)
}

export async function sendAccountEmail(userId: string, purpose: 'verify' | 'reset'): Promise<void> {
  const database = getDatabase()
  const user = database.prepare(`SELECT id, email, emailVerified, activationStatus FROM user WHERE id = ?`).get(userId) as { id: string; email: string; emailVerified: number; activationStatus: string } | undefined
  if (!user || user.activationStatus !== 'active') return
  if (purpose === 'verify' && user.emailVerified) return
  if (purpose === 'reset' && (!user.emailVerified || !database.prepare("SELECT 1 FROM account WHERE userId = ? AND providerId = 'credential' AND issuer = 'local:credential' AND password IS NOT NULL").get(userId))) return
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new Error('Email delivery is not configured. Contact an administrator.')
  if (!claimDelivery(`${purpose}:${digest(user.email.toLowerCase())}`, 60_000)) return
  const token = randomBytes(32).toString('base64url')
  database.prepare('DELETE FROM account_email_token WHERE expires_at <= ?').run(Date.now())
  database.prepare('INSERT INTO account_email_token (token_hash, user_id, email, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(digest(token), userId, user.email, purpose, Date.now() + (purpose === 'reset' ? 15 : 60) * 60_000, Date.now())
  const url = new URL(purpose === 'verify' ? '/verify-email' : '/reset-password', authEnvironment.baseUrl)
  url.searchParams.set('token', token)
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  })
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM, to: user.email,
      subject: purpose === 'verify' ? 'Verify your FrankerzSpam email' : 'Reset your FrankerzSpam password',
      text: `${purpose === 'verify' ? 'Verify your email to publish and request viewing access.' : 'Reset your password. This signs you out on all devices.'}\n\n${url}\n\nThis link can be used once and expires in ${purpose === 'verify' ? '60' : '15'} minutes. If you did not request it, ignore this email.`,
    })
  } catch {
    database.prepare('DELETE FROM account_email_token WHERE token_hash = ?').run(digest(token))
    throw new Error('Email could not be sent. Try again in a minute or contact an administrator.')
  } finally { transport.close() }
}

export async function requestPasswordRecovery(email: string): Promise<void> {
  const user = getDatabase().prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE').get(email.trim()) as { id: string } | undefined
  if (user) await sendAccountEmail(user.id, 'reset')
}

export function consumeEmailVerificationToken(token: string): string | null {
  const database = getDatabase()
  return database.transaction(() => {
    const row = database.prepare(`SELECT t.user_id AS userId FROM account_email_token t JOIN user u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.purpose = 'verify' AND t.expires_at > ? AND t.email = u.email AND u.activationStatus = 'active'`).get(digest(token), Date.now()) as { userId: string } | undefined
    if (!row) return null
    database.prepare("DELETE FROM account_email_token WHERE user_id = ? AND purpose = 'verify'").run(row.userId)
    database.prepare('UPDATE user SET emailVerified = 1, updatedAt = ? WHERE id = ?').run(Date.now(), row.userId)
    return row.userId
  })()
}
