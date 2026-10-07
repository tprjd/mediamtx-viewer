// @vitest-environment node
import Database from 'better-sqlite3'
import { createServer, type Socket } from 'node:net'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { hashPassword, verifyPassword } from 'better-auth/crypto'

vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
const messages: string[] = []
const sockets = new Set<Socket>()
const smtp = createServer((socket) => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket))
  socket.write('220 localhost SMTP\r\n')
  let buffer = '', body = '', data = false
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    while (buffer.includes('\r\n')) {
      const index = buffer.indexOf('\r\n')
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 2)
      if (data) {
        if (line === '.') { messages.push(body); body = ''; data = false; socket.write('250 accepted\r\n') }
        else body += `${line}\n`
      } else if (line.startsWith('DATA')) { data = true; socket.write('354 send data\r\n') }
      else if (line.startsWith('QUIT')) socket.end('221 bye\r\n')
      else socket.write('250 OK\r\n')
    }
  })
})
beforeAll(async () => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${file}`, 'utf8'))
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve))
  const address = smtp.address()
  if (!address || typeof address === 'string') throw new Error('SMTP receiver unavailable')
  vi.stubEnv('SMTP_HOST', '127.0.0.1'); vi.stubEnv('SMTP_PORT', String(address.port)); vi.stubEnv('SMTP_REQUIRE_TLS', 'false'); vi.stubEnv('SMTP_FROM', 'Test <mail@example.test>')
  database.prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus) VALUES ('user', 'Name', 'mail@example.test', 0, 0, 0, 'active')").run()
  database.prepare("INSERT INTO account (id, issuer, accountId, userId, providerId, password, createdAt, updatedAt) VALUES ('password', 'local:credential', 'user', 'user', 'credential', ?, 0, 0)").run(await hashPassword('original secure password'))
})
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => smtp.close(() => resolve()))
  database.close(); vi.unstubAllEnvs()
})
function token(message: string) {
  const url = message.replace(/=\n/g, '').replace(/=3D/g, '=').match(/http[^\s]+/)
  return new URL(url![0]).searchParams.get('token')!
}
it('delivers verification by SMTP and permits recovery only after verification', async () => {
  const { sendAccountEmail, requestPasswordRecovery, consumeEmailVerificationToken } = await import('./email')
  await requestPasswordRecovery('mail@example.test')
  expect(messages).toHaveLength(0)
  await sendAccountEmail('user', 'verify')
  expect(messages).toHaveLength(1)
  const verification = token(messages[0])
  expect(consumeEmailVerificationToken(verification)).toBe('user')
  expect(consumeEmailVerificationToken(verification)).toBeNull()
  await requestPasswordRecovery('mail@example.test')
  expect(messages).toHaveLength(2)
  const reset = token(messages[1])
  const { resetPasswordAction } = await import('@/app/reset-password/actions')
  const form = new FormData()
  form.set('token', reset); form.set('password', 'a different secure password'); form.set('confirmPassword', 'a different secure password')
  expect(await resetPasswordAction({ status: 'idle' }, form)).toMatchObject({ status: 'success' })
  expect(await resetPasswordAction({ status: 'idle' }, form)).toMatchObject({ status: 'error' })
  const row = database.prepare("SELECT password FROM account WHERE id = 'password'").get() as { password: string }
  expect(await verifyPassword({ hash: row.password, password: 'a different secure password' })).toBe(true)
})
it('does not send recovery for provider-only or unknown accounts, and rejects expired links', async () => {
  const { requestPasswordRecovery, sendAccountEmail, consumeEmailVerificationToken } = await import('./email')
  database.prepare("DELETE FROM account WHERE userId = 'user'").run()
  await requestPasswordRecovery('mail@example.test'); await requestPasswordRecovery('unknown@example.test')
  expect(messages).toHaveLength(2)
  database.prepare("UPDATE user SET emailVerified = 0 WHERE id = 'user'").run()
  database.prepare('DELETE FROM account_email_throttle').run()
  await sendAccountEmail('user', 'verify')
  const expired = token(messages[2])
  database.prepare('UPDATE account_email_token SET expires_at = 0').run()
  expect(consumeEmailVerificationToken(expired)).toBeNull()
})
