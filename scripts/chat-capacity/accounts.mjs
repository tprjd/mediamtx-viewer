import Database from 'better-sqlite3'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const [action, path] = process.argv.slice(2)
if (!['create', 'disable'].includes(action) || !path || process.env.CHAT_CAPACITY_ACCOUNTS !== 'confirmed')
  throw new Error('Set CHAT_CAPACITY_ACCOUNTS=confirmed and run accounts.mjs create|disable PRIVATE_FILE')
const db = new Database(process.env.AUTH_DB_PATH, {fileMustExist: true})
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
try {
  if (action === 'create') {
    const secret = process.env.BETTER_AUTH_SECRET
    if (!secret || secret.length < 32) throw new Error('Missing account session signing secret')
    const prefix = `capacity-${randomUUID()}`
    const now = Date.now()
    const administrator = db.prepare("SELECT id FROM user WHERE role = 'admin' AND activationStatus = 'active' LIMIT 1").get()
    if (!administrator) throw new Error('An active administrator is required')
    const participants = []
    db.transaction(() => {
      for (let i = 0; i < 100; i++) {
        const id = `${prefix}-${i}`
        const token = randomBytes(32).toString('hex')
        db.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt,
          role, banned, activationStatus, activatedAt, activatedBy)
          VALUES (?, 'Capacity check', ?, 0, ?, ?, 'user', 0, 'active', ?, ?)`)
          .run(id, `${id}@example.invalid`, now, now, now, administrator.id)
        db.prepare(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), now + 2 * 3600000, token, now, now, id)
        const signature = createHmac('sha256', secret).update(token).digest('base64')
        participants.push({accountId: id,
          cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`})
      }
      // Write before commit: a failed write must not leave accounts without a cleanup record.
      writeFileSync(path, JSON.stringify({prefix, participants}, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
    })()
    console.log('Created 100 temporary active accounts with two-hour sessions.')
  } else {
    const {prefix, participants} = JSON.parse(readFileSync(path, 'utf8'))
    if (!/^capacity-[a-f0-9-]{36}$/.test(prefix) || participants.length !== 100 ||
        participants.some((p, i) => p.accountId !== `${prefix}-${i}`)) throw new Error('Invalid capacity account record')
    db.transaction(() => {
      for (const {accountId} of participants) {
        db.prepare('DELETE FROM session WHERE userId = ?').run(accountId)
        db.prepare("UPDATE user SET activationStatus = 'disabled', disabledAt = ?, updatedAt = ? WHERE id = ?")
          .run(Date.now(), Date.now(), accountId)
      }
    })()
    if (process.env.CHAT_ENABLED === 'true') {
      for (const {accountId} of participants) {
        const response = await fetch(`${process.env.CENTRIFUGO_API_URL}/disconnect`, {
          method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': process.env.CENTRIFUGO_API_KEY},
          body: JSON.stringify({user: accountId}), signal: AbortSignal.timeout(3000),
        })
        const result = await response.json()
        if (!response.ok || result.error) throw new Error('CAPACITY_ACCOUNT_DISCONNECT_FAILED')
      }
    }
    console.log('Disabled 100 test accounts and removed their sessions.')
  }
} finally {db.close()}
