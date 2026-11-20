import 'server-only'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.RELAY_ASSETS_DIR ?? '.data/relay-assets'

export function relayHelperHash(): string | undefined {
  const path = join(dir, 'sha256.txt')
  if (!existsSync(path)) return undefined
  const hash = readFileSync(path, 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid Windows relay helper digest.')
  return hash
}

export function relayHelperBinary(): Buffer {
  return readFileSync(join(dir, 'relay-hls.exe'))
}
