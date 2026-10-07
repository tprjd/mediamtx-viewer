// @vitest-environment node
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const name of readdirSync('migrations').filter(x => x.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${name}`, 'utf8'))

it('copies real WHIP video to AAC HLS, survives worker restart, and stops revoked-source audio conversion', async () => {
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
  const network = `${name}-net`
  const image = 'frankerzspam-hls-media-test:local'
  const publisher = `${name}-publisher`
  const worker = `${name}-worker`
  const docker = async (...args: string[]) => (await promisify(execFile)('docker', args, { encoding: 'utf8', timeout: 120000 })).stdout
  const stop = async (container: string) => {
    try { await docker('stop', '-t', '3', container) } catch { /* Container may already be stopped. */ }
    try { await docker('rm', '-f', container) } catch { /* --rm may have removed it. */ }
  }
  const until = async (check: () => Promise<boolean>, timeout = 25000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) { if (await check()) return; await delay(500) }
    throw new Error('Media acceptance condition timed out')
  }
  const startWorker = () => docker('run', '-d', '--name', worker,
    '--network', network, '--add-host', 'host.docker.internal:host-gateway',
    '-e', `VIEWER_URL=http://host.docker.internal:${port}`, '-e', `MEDIAMTX_RTSP_URL=rtsp://${name}:8554`,
    '-e', `WHIP_PILOT_CHANNEL=${channel.slug}`, '-e', `HLS_WORKER_SECRET=${process.env.HLS_WORKER_SECRET}`, image)
  try {
    await docker('build', '-t', image, '-f', 'scripts/hls-media.Dockerfile', '.')
    await docker('network', 'create', network)
    await docker('run', '-d', '--rm', '--name', name, '--network', network, '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1:19978:9997', '-p', '127.0.0.1:28891:8888',
      '-e', 'MTX_API=yes', '-e', 'MTX_AUTHMETHOD=http', '-e', `MTX_AUTHHTTPADDRESS=http://host.docker.internal:${port}/api/internal/mediamtx/authorize?secret=test-mtx-secret`,
      '-e', 'MTX_WEBRTCIPSFROMINTERFACESLIST=eth0', '-e', 'MTX_HLSALWAYSREMUX=yes', 'bluenviron/mediamtx:1.20.1')
    await until(async () => { try { return (await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/list`)).ok } catch { return false } })
    await docker('run', '-d', '--name', publisher, '--network', network, '--entrypoint', 'ffmpeg', image, '-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline', '-bf', '0', '-g', '60', '-b:v', '600k', '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-f', 'whip', '-authorization', key.token, `http://${name}:8889/${channel.mediaPath}/whip`)
    await startWorker()
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
    const probe = JSON.parse(await docker('run', '--rm', '--network', network, '--entrypoint', 'ffprobe', image, '-v', 'error', '-show_streams', '-of', 'json', `http://${name}:8888/${outputPath}/index.m3u8`))
    expect(probe.streams.map((stream: { codec_name: string }) => stream.codec_name).sort()).toEqual(['aac', 'h264'])
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    await stop(worker)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    await startWorker()
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return r.ok && (await r.json()).ready })
    // Simulate a key rotation whose best-effort Publisher disconnect failed.
    createOrRotateStreamKey('media-owner')
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return !r.ok || !(await r.json()).ready })
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true })
    await stop(publisher)
    await until(async () => !(await getChannelStatus(channel.mediaPath)).live)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: false })
  } finally {
    await stop(publisher)
    await stop(worker)
    for (const container of [publisher, worker, name]) {
      try { await docker('rm', '-f', container) } catch { /* Already removed. */ }
    }
    try { await docker('network', 'rm', network) } catch { /* Setup may have failed. */ }
    await new Promise<void>(resolve => server.close(() => resolve()))
    database.close()
  }
}, 180000)
