import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve('.data/relay-assets')
mkdirSync(dir, { recursive: true })
const file = resolve(dir, 'relay-hls.exe')
execFileSync('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', file, '.'], {
  cwd: 'scripts/relay-hls', stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64' },
})
writeFileSync(resolve(dir, 'sha256.txt'), createHash('sha256').update(readFileSync(file)).digest('hex') + '\n')
