import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This checks a candidate server patch. It does not change the deployed MediaMTX image.
const fixtures = fileURLToPath(new URL('./fixtures/whip-packet-loss/', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'whip-packet-loss-'))
const run = (cwd, command, args) => execFileSync(command, args, {
  cwd, stdio: 'inherit', env: { ...process.env, GOTOOLCHAIN: 'auto' },
})

try {
  for (const [name, tag, commit] of [
    ['gortsplib', 'v5.6.4', 'dde452c28bac66c4c5e03400d534ab26283ed8e6'],
    ['mediamtx', 'v1.20.1', '883194a19b7244355c9bc975c0574c9842733637'],
  ]) {
    run(root, 'git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth=1', '--branch', tag, `https://github.com/bluenviron/${name}.git`, name])
    const cwd = join(root, name)
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(), commit)
    run(cwd, 'git', ['apply', join(fixtures, `${name}.patch`)])
  }
  const media = join(root, 'mediamtx')
  for (const file of ['packet_loss_test.go', 'inbound_track_repair_test.go']) {
    copyFileSync(join(fixtures, file), join(media, 'internal/protocols/webrtc', file))
  }
  run(media, 'go', ['mod', 'edit', '-replace', 'github.com/bluenviron/gortsplib/v5=../gortsplib'])
  run(join(root, 'gortsplib'), 'go', ['test', '-race', './pkg/rtpreceiver', '-count=1', '-timeout=60s'])
  run(media, 'go', ['test', '-race', './internal/protocols/webrtc', '-run',
    'TestWorsePacketLoss|TestInboundVideoLateRepair|TestPeerConnectionRead$|TestPeerConnectionRecomputeSequenceNumber|TestPeerConnectionStripIncomingTWCC',
    '-v', '-count=1', '-timeout=60s'])
  run(media, 'go', ['generate', './internal/core', './internal/servers/hls'])
  run(media, 'go', ['build', '-o', join(root, 'mediamtx-test'), '.'])
} finally {
  rmSync(root, { recursive: true, force: true })
}
