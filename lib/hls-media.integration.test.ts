// @vitest-environment node
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const name of readdirSync('migrations').filter(x => x.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${name}`, 'utf8'))

it('copies real WHIP video to AAC HLS, survives worker restart, and removes stale media on source end', async () => {
  process.env.MEDIAMTX_AUTH_SECRET = 'test-mtx-secret'
  process.env.HLS_WORKER_SECRET = 'test-hls-worker-secret-with-at-least-32-characters'
  process.env.MEDIAMTX_API_URL = 'http://127.0.0.1:19978'
  const { getOwnedChannel, createOrRotateStreamKey } = await import('./channels')
  database.exec("INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,activationStatus) VALUES ('media-owner','Owner','media@test.invalid',1,0,0,'active')")
  const channel = getOwnedChannel('media-owner')!
  process.env.WHIP_PILOT_CHANNEL = channel.slug
  const key = createOrRotateStreamKey('media-owner')
  const { GET } = await import('../app/api/internal/hls-worker/route')
  const { POST } = await import('../app/api/internal/mediamtx/authorize/route')
  const { getChannelStatus } = await import('./mediamtx')
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string,string>, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) })
      const response = req.url?.startsWith('/api/internal/hls-worker') ? await GET(request) : await POST(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch { res.writeHead(500); res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
  const port = (server.address() as { port: number }).port
  const name = `whip-hls-media-${process.pid}`
  let publisher: ChildProcess | undefined
  let worker: ChildProcess | undefined
  const stop = async (child?: ChildProcess) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 4000)
    await exited
    clearTimeout(timeout)
  }
  const until = async (check: () => Promise<boolean>, timeout = 25000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) { if (await check()) return; await delay(500) }
    throw new Error('Media acceptance condition timed out')
  }
  const startWorker = () => spawn(process.execPath, ['scripts/hls-worker.mjs'], { env: { ...process.env, VIEWER_URL: `http://127.0.0.1:${port}`, MEDIAMTX_RTSP_URL: 'rtsp://127.0.0.1:18555' }, stdio: 'ignore' })
  try {
    execFileSync('docker', ['run', '-d', '--rm', '--name', name,
      '-p', '19978:9997', '-p', '18890:8889', '-p', '28891:8888', '-p', '18555:8554', '-p', '18989:18989/udp',
      '-e', 'MTX_API=yes', '-e', 'MTX_AUTHMETHOD=http', '-e', `MTX_AUTHHTTPADDRESS=http://host.docker.internal:${port}/api/internal/mediamtx/authorize?secret=test-mtx-secret`,
      '-e', 'MTX_WEBRTCLOCALUDPADDRESS=:18989', '-e', 'MTX_WEBRTCIPSFROMINTERFACES=no', '-e', 'MTX_WEBRTCADDITIONALHOSTS=127.0.0.1',
      '-e', 'MTX_HLSALWAYSREMUX=yes', 'bluenviron/mediamtx:1.20.1'], { stdio: 'pipe' })
    await until(async () => { try { return (await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/list`)).ok } catch { return false } })
    publisher = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline', '-bf', '0', '-g', '60', '-b:v', '600k', '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-f', 'whip', '-authorization', key.token, `http://127.0.0.1:18890/${channel.mediaPath}/whip`], { stdio: 'ignore' })
    worker = startWorker()
    let outputPath = ''
    await until(async () => {
      const { jobs } = await (await GET(new Request('http://localhost/api/internal/hls-worker', { headers: { 'x-hls-worker-secret': process.env.HLS_WORKER_SECRET! } }))).json()
      outputPath = jobs[0]?.outputPath ?? ''
      if (!outputPath) return false
      const response = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`)
      return response.ok && (await response.json()).ready
    })
    const hls = `http://127.0.0.1:28891/${outputPath}/index.m3u8`
    await until(async () => (await fetch(hls)).ok)
    const probe = JSON.parse((await promisify(execFile)('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', hls], { encoding: 'utf8', timeout: 15000 })).stdout)
    expect(probe.streams.map((stream: { codec_name: string }) => stream.codec_name).sort()).toEqual(['aac', 'h264'])
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    await stop(worker)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    worker = startWorker()
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return r.ok && (await r.json()).ready })
    await stop(publisher)
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return !r.ok || !(await r.json()).ready })
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: false })
  } finally {
    await stop(publisher)
    await stop(worker)
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'pipe' }) } catch {}
    await new Promise<void>(resolve => server.close(() => resolve()))
    database.close()
  }
}, 90000)
