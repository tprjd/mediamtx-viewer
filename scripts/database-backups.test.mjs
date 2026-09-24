// @vitest-environment node
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('backs up separate encrypted databases with one authenticated manifest and cleans Chat first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-test-'))
  try {
    const env = {
      ...process.env,
      AUTH_DB_PATH: join(dir, 'auth.sqlite'),
      CHAT_DB_PATH: join(dir, 'chat.sqlite'),
      AUTH_BACKUP_DIR: join(dir, 'backups'),
      AUTH_BACKUP_KEY: Buffer.alloc(32, 7).toString('base64'),
    }
    for (const script of ['migrate.mjs', 'migrate-chat.mjs']) {
      expect(
        spawnSync(process.execPath, [`scripts/${script}`], { env }).status,
      ).toBe(0)
    }
    const db = new Database(env.CHAT_DB_PATH)
    db.exec(`INSERT INTO chat_room (id, channel_id, next_sequence, created_at) VALUES ('room', 'channel', 2, 0);
      INSERT INTO chat_message (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
      VALUES ('old', 'room', 1, 'account', 'Name', 'tag1', 'secret message', 0)`)
    const result = spawnSync(process.execPath, ['scripts/backup-auth.mjs'], {
      env,
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(result.stdout.trim(), 'utf8'))
    expect(manifest).toMatchObject({
      version: 1,
      databases: {
        auth: { file: 'auth.sqlite.enc' },
        chat: { file: 'chat.sqlite.enc' },
      },
    })
    expect(manifest.id).toBeTruthy()
    expect(manifest.signature).toHaveLength(64)
    const files = readdirSync(join(env.AUTH_BACKUP_DIR, manifest.id))
    expect(files.sort()).toEqual([
      'auth.sqlite.enc',
      'chat.sqlite.enc',
      'manifest.json',
    ])
    for (const name of ['auth', 'chat']) {
      const encrypted = readFileSync(
        join(env.AUTH_BACKUP_DIR, manifest.id, `${name}.sqlite.enc`),
      )
      expect(encrypted.includes(Buffer.from('SQLite format'))).toBe(false)
      expect(encrypted.includes(Buffer.from('secret message'))).toBe(false)
    }
    expect(
      db.prepare('SELECT count(*) AS count FROM chat_message').get().count,
    ).toBe(0)
    db.prepare(
      `INSERT INTO chat_message (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
      VALUES ('new', 'room', 2, 'account', 'Name', 'tag1', 'after backup', ?)`,
    ).run(Date.now())
    const auth = new Database(env.AUTH_DB_PATH)
    auth
      .prepare(
        `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, activationStatus)
      VALUES ('later-account', 'Name', 'later@example.test', 0, ?, ?, 'active')`,
      )
      .run(Date.now(), Date.now())
    auth.close()
    const restore = spawnSync(
      process.execPath,
      ['scripts/restore-auth.mjs', result.stdout.trim()],
      {
        env: { ...env, AUTH_RESTORE_CONFIRM: 'replace' },
        encoding: 'utf8',
      },
    )
    expect(restore.status, restore.stderr).toBe(0)
    const restoredAuth = new Database(env.AUTH_DB_PATH)
    expect(
      restoredAuth.prepare('SELECT count(*) AS count FROM user').get().count,
    ).toBe(0)
    restoredAuth.close()
    expect(db.prepare('SELECT content FROM chat_message').get()).toEqual({
      content: 'after backup',
    })
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('keeps seven complete daily sets, removes incomplete sets, and selects each database independently', async () => {
  const { createBackupSet, decryptDatabaseBackup } = await import(
    './database-backups.mjs'
  )
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'backup-rotation-'))
  try {
    const authPath = join(dir, 'auth.sqlite')
    const chatPath = join(dir, 'chat.sqlite')
    const directory = join(dir, 'backups')
    const key = Buffer.alloc(32, 8)
    for (const [script, variable, path] of [
      ['migrate.mjs', 'AUTH_DB_PATH', authPath],
      ['migrate-chat.mjs', 'CHAT_DB_PATH', chatPath],
    ]) {
      expect(
        spawnSync(process.execPath, [`scripts/${script}`], {
          env: { ...process.env, [variable]: path },
        }).status,
      ).toBe(0)
    }
    mkdirSync(directory)
    const incomplete = join(
      directory,
      '2026-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000',
    )
    mkdirSync(incomplete)
    writeFileSync(join(incomplete, 'auth.sqlite.enc'), 'partial')
    mkdirSync(join(directory, '.pending-crashed'))
    writeFileSync(
      join(directory, '.pending-crashed', 'chat.sqlite'),
      'plaintext',
    )
    let manifest
    for (let day = 1; day <= 9; day++) {
      manifest = await createBackupSet({
        authPath,
        chatPath,
        directory,
        key,
        now: new Date(`2026-09-${String(day).padStart(2, '0')}T00:00:00Z`),
      })
    }
    const sameDay = await createBackupSet({
      authPath,
      chatPath,
      directory,
      key,
      now: new Date('2026-09-09T12:00:00Z'),
    })
    expect(existsSync(manifest)).toBe(false)
    manifest = sameDay
    expect(readdirSync(directory)).toHaveLength(7)
    expect(existsSync(incomplete)).toBe(false)
    for (const name of ['auth', 'chat']) {
      const output = join(dir, `${name}-restored.sqlite`)
      await decryptDatabaseBackup(manifest, name, output, key)
      const restored = new Database(output)
      expect(
        restored
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(name === 'auth' ? 'user' : 'chat_message'),
      ).toBeTruthy()
      expect(
        restored
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(name === 'chat' ? 'user' : 'chat_message'),
      ).toBeUndefined()
      restored.close()
    }
    await expect(
      decryptDatabaseBackup(
        manifest,
        'chat',
        join(dir, 'wrong-key'),
        Buffer.alloc(32, 9),
      ),
    ).rejects.toThrow()
    const existing = join(dir, 'existing')
    writeFileSync(existing, 'keep this file')
    await expect(
      decryptDatabaseBackup(manifest, 'chat', existing, key),
    ).rejects.toThrow()
    expect(readFileSync(existing, 'utf8')).toBe('keep this file')
    const authBackup = join(
      directory,
      JSON.parse(readFileSync(manifest, 'utf8')).id,
      'auth.sqlite.enc',
    )
    const ciphertext = readFileSync(authBackup)
    writeFileSync(authBackup, Buffer.from('damaged'))
    await expect(
      decryptDatabaseBackup(manifest, 'chat', join(dir, 'incomplete'), key),
    ).rejects.toThrow('checksum')
    writeFileSync(authBackup, ciphertext)
    const raw = JSON.parse(readFileSync(manifest, 'utf8'))
    raw.createdAt = '2026-01-01T00:00:00Z'
    writeFileSync(manifest, JSON.stringify(raw))
    await expect(
      decryptDatabaseBackup(manifest, 'chat', join(dir, 'tampered'), key),
    ).rejects.toThrow('signature')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('preserves complete backup sets when the encryption key changes', async () => {
  const { createBackupSet } = await import('./database-backups.mjs')
  const { existsSync } = await import('node:fs')
  const directory = mkdtempSync(join(tmpdir(), 'backup-key-change-'))
  try {
    const paths = {
      authPath: join(directory, 'auth.sqlite'),
      chatPath: join(directory, 'chat.sqlite'),
      directory: join(directory, 'backups'),
    }
    for (const [script, variable, path] of [
      ['migrate.mjs', 'AUTH_DB_PATH', paths.authPath],
      ['migrate-chat.mjs', 'CHAT_DB_PATH', paths.chatPath],
    ]) {
      expect(
        spawnSync(process.execPath, [`scripts/${script}`], {
          env: { ...process.env, [variable]: path },
        }).status,
      ).toBe(0)
    }
    const old = await createBackupSet({ ...paths, key: Buffer.alloc(32, 1) })
    await createBackupSet({ ...paths, key: Buffer.alloc(32, 2) })
    expect(existsSync(old)).toBe(true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

await import("./fixtures/maintenance/docker-tests.mjs")
