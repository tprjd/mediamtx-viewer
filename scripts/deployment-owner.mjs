// Executed inline so recovery does not depend on an interrupted script copy.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
const path = '/stage/connection.json'
const [action, token] = process.argv.slice(1)
const boot = () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')
const start = pid => readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[21]
if (action === 'check') {
  const owner = JSON.parse(readFileSync(path, 'utf8'))
  if (owner.token !== token || owner.boot !== boot() || owner.start !== start(owner.pid)) process.exit(1)
} else if (action === 'hold') {
  // flock holds the host lock while this connection is alive. No timeout steals it.
  writeFileSync(path, JSON.stringify({ token, pid: process.pid, boot: boot(), start: start(process.pid) }), { mode: 0o600 })
  process.stdin.resume()
  process.stdin.on('end', () => { rmSync(path, { force: true }); process.exit(0) })
  process.stdin.on('error', () => process.exit(1))
  console.log('owned')
} else process.exit(1)
