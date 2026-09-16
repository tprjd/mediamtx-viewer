// THROWAWAY launcher. Scratch Channel fixtures only; Chat messages live in memory.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'

const port = Number(process.env.PROTOTYPE_CHAT_PORT ?? 3400)
mkdirSync('.data', { recursive: true })
const scratch = mkdtempSync(resolve('.data/PROTOTYPE-chat-'))
const databasePath = resolve(scratch, 'auth.sqlite')
const env = {
  ...process.env,
  AUTH_DB_PATH: databasePath,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  INTERNAL_AUTH_SECRET: randomBytes(32).toString('hex'),
  MEDIAMTX_AUTH_SECRET: randomBytes(32).toString('hex'),
  CHAT_ENABLED: 'false',
  NEXT_DIST_DIR: '.next-chat-prototype',
}
const migration = spawnSync(process.execPath, ['scripts/migrate.mjs'], { env, stdio: 'inherit' })
if (migration.status !== 0) process.exit(1)
const database = new Database(databasePath)
const now = Date.now()
for (const [slug, name, title, description] of [
  ['chat-preview', 'David', 'One more run. Then we call it a night.', 'Late-night games and good company.'],
  ['mira-preview', 'mira', 'Building something small', 'A quiet creative evening.'],
  ['orbit-preview', 'orbit', 'After hours', 'Music and conversation.'],
]) {
  database.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, activationStatus)
    VALUES (?, ?, ?, 0, ?, ?, 'user', 'active')`).run(slug, name, `${slug}@example.test`, now, now)
  database.prepare(`INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, description,
    accent_color, preferred_playback, enabled, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, '#db2777', 'hls', 1, ?, ?, ?)`).run(slug, slug, slug, `channels/${slug}`, name, title, description, now, now, slug)
}
database.close()

const api = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ items: ['chat-preview', 'mira-preview'].map((slug) => ({
    name: `channels/${slug}`, ready: true, readyTime: new Date(now).toISOString(), tracks: ['H264', 'MPEG-4 Audio'],
    readers: Array.from({ length: slug === 'chat-preview' ? 24 : 8 }, (_, index) => ({ id: `sample-${index}`, type: 'browserFixture' })),
  })) }))
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
env.MEDIAMTX_API_URL = `http://127.0.0.1:${api.address().port}`
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'inherit' })
console.log(`\nChat prototype: http://localhost:${port}/watch/chat-preview?variant=A`)
console.log('Variants: A = Compact feed, B = Time groups, C = Tools rail. Use the bottom arrows to compare.\n')
const cleanup = () => { api.close(); rmSync(scratch, { recursive: true, force: true }) }
next.on('exit', (code) => { cleanup(); process.exit(code ?? 0) })
process.on('SIGINT', () => next.kill('SIGINT'))
process.on('SIGTERM', () => next.kill('SIGTERM'))
