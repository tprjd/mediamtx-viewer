import { spawn } from 'node:child_process'

// The existing worker image owns both subprocesses. FFmpeg retries are isolated
// in the HLS supervisor. A supervisor exit restarts the container as a unit.
const children = ['thumbnail-worker.mjs', 'hls-worker.mjs'].map(script =>
  spawn(process.execPath, [new URL(script, import.meta.url).pathname], { stdio: 'inherit' }))
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 4000).unref()
}
for (const child of children) {
  child.once('error', () => stop(1))
  child.once('exit', () => stop(1))
}
process.on('SIGTERM', () => stop(0))
process.on('SIGINT', () => stop(0))
