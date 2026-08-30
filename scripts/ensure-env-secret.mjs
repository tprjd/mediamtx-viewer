import { appendFileSync, chmodSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const [filePath, key] = process.argv.slice(2)
if (!filePath || !key || !/^[A-Z][A-Z0-9_]+$/.test(key)) {
  throw new Error('Usage: node scripts/ensure-env-secret.mjs <env-file> <ENV_KEY>')
}

const current = readFileSync(filePath, 'utf8')
if (new RegExp(`^${key}=.+$`, 'm').test(current)) {
  process.stdout.write(`${key} already exists.\n`)
  process.exit(0)
}

const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
appendFileSync(filePath, `${prefix}${key}=${randomBytes(32).toString('hex')}\n`, {
  mode: 0o600,
})
chmodSync(filePath, 0o600)
process.stdout.write(`Added ${key}.\n`)
