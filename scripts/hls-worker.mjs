import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

export async function runHlsWorker() {
  const endpoint = `${process.env.VIEWER_URL ?? 'http://viewer:3000'}/api/internal/hls-worker`
  const secret = process.env.HLS_WORKER_SECRET ?? ''
  const rtspOrigin = process.env.MEDIAMTX_RTSP_URL ?? 'rtsp://mediamtx:8554'
  let stopping = false
  let current = null
  let lastIdentity = null
  let failures = 0
  let retryAt = 0
  const stop = async () => {
    if (!current) return
    const child = current.child
    current = null
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000)
    await exited
    clearTimeout(kill)
  }
  const shutdown = () => { stopping = true; void stop() }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  try {
    while (!stopping) {
      let jobs = []
      let state = 'disabled'
      if (secret && process.env.WHIP_PILOT_CHANNEL) {
        try {
          const response = await fetch(endpoint, { headers: { 'x-hls-worker-secret': secret }, signal: AbortSignal.timeout(3000) })
          if (!response.ok) throw new Error('Control unavailable')
          jobs = (await response.json()).jobs
          if (!Array.isArray(jobs) || jobs.length > 1) throw new Error('Invalid jobs')
          state = 'idle'
        } catch { state = 'control-unavailable' }
      }
      const job = jobs[0]
      const identity = job ? JSON.stringify(job) : null
      if (identity !== lastIdentity) {
        lastIdentity = identity
        failures = 0
        retryAt = 0
      }
      if (current && current.identity !== identity) {
        await stop()
        failures = 0
        retryAt = 0
      }
      if (job && !current && Date.now() >= retryAt && !stopping) {
        const url = path => {
          const value = new URL(rtspOrigin)
          value.username = 'hls-worker'
          value.password = job.credential
          value.pathname = path
          return value.href
        }
        const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-rtsp_transport', 'tcp', '-timeout', '5000000', '-i', url(job.sourcePath),
          '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-ar', '48000', '-ac', '2', '-f', 'rtsp', '-rtsp_transport', 'tcp', url(job.outputPath),
        ], { stdio: 'ignore' })
        const entry = { identity, child, startedAt: Date.now() }
        current = entry
        const failed = () => {
          if (current !== entry) return
          current = null
          if (Date.now() - entry.startedAt > 60000) failures = 0
          failures += 1
          retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5))
          console.warn('HLS audio worker stopped; bounded retry scheduled')
        }
        child.once('error', failed)
        child.once('exit', failed)
      }
      if (current) state = 'converting'
      else if (job) state = 'retrying'
      if (process.env.HLS_WORKER_HEALTH_FILE) await writeFile(process.env.HLS_WORKER_HEALTH_FILE, JSON.stringify({ state, checkedAt: new Date().toISOString() }))
      await delay(1000)
    }
  } finally {
    await stop()
    process.off('SIGTERM', shutdown)
    process.off('SIGINT', shutdown)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHlsWorker().catch(() => { console.error('HLS worker control loop failed'); process.exitCode = 1 })
}
