// @vitest-environment node
import Database from 'better-sqlite3'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))
for (const name of readdirSync('migrations').filter(x => x.endsWith('.sql')).sort()) database.exec(readFileSync(`migrations/${name}`, 'utf8'))

it('keeps WHIP HLS audio in sync across worker restart and preserves RTMP AAC playback', async () => {
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
  const captures = mkdtempSync(join(tmpdir(), 'hls-sync-'))
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
    '-e', `VIEWER_URL=http://host.docker.internal:${port}`, '-e', `MEDIAMTX_RTMP_URL=rtmp://${name}:1935`,
    '-e', `WHIP_PILOT_CHANNEL=${channel.slug}`, '-e', `HLS_WORKER_SECRET=${process.env.HLS_WORKER_SECRET}`, image)
  const assertAudioVideoSync = async (hls: string) => {
    const master = await fetch(hls)
    const manifest = await master.text()
    const tracks = [
      { name: 'video', uri: manifest.split('\n').find(line => line && !line.startsWith('#'))!, filter: 'scale=16:16,signalstats', tag: 'lavfi.signalstats.YAVG', threshold: 220 },
      { name: 'audio', uri: manifest.match(/#EXT-X-MEDIA:.*URI="([^"]+)"/)![1], filter: 'astats=metadata=1:reset=1', tag: 'lavfi.astats.Overall.RMS_level', threshold: -30 },
    ]
    const pulses: number[][] = []
    // Capture both playlists before decoding either track, so a slow video
    // probe cannot move the audio capture beyond the common live interval.
    await Promise.all(tracks.map(async track => {
      const playlist = await fetch(new URL(track.uri, master.url))
      const text = await playlist.text()
      const init = text.match(/#EXT-X-MAP:URI="([^"]+)"/)![1]
      const segments = text.split('\n').filter(line => line && !line.startsWith('#') && !line.startsWith('gap.mp4')).slice(-3)
      expect(segments.length).toBeGreaterThanOrEqual(2)
      const buffers = await Promise.all([init, ...segments].map(async uri => {
        const response = await fetch(new URL(uri, playlist.url))
        expect(response.ok).toBe(true)
        return Buffer.from(await response.arrayBuffer())
      }))
      const file = join(captures, `${track.name}.mp4`)
      writeFileSync(file, Buffer.concat(buffers))
      await docker('cp', file, `${worker}:/tmp/sync-${track.name}.mp4`)
    }))
    for (const track of tracks) {
      const { frames } = JSON.parse(await docker('exec', worker, 'ffprobe', '-v', 'error', '-f', 'lavfi', '-i',
        `${track.name === 'audio' ? 'amovie' : 'movie'}=/tmp/sync-${track.name}.mp4,${track.filter}`,
        '-show_frames', '-show_entries', `frame=pts_time:frame_tags=${track.tag}`, '-of', 'json'))
      let previous = true // Ignore a capture that starts in the middle of a pulse.
      const edges: number[] = []
      for (const frame of frames) {
        const active = Number(frame.tags?.[track.tag]) > track.threshold
        if (active && !previous) edges.push(Number(frame.pts_time))
        previous = active
      }
      expect(edges.length).toBeGreaterThanOrEqual(2)
      pulses.push(edges)
    }
    const [video, audio] = pulses
    const overlap = video.filter(time => time >= audio[0] - 1 && time <= audio.at(-1)! + 1)
    expect(overlap.length).toBeGreaterThanOrEqual(2)
    for (const time of overlap) {
      expect(Math.min(...audio.map(sample => Math.abs(sample - time))), 'AAC pulse must stay aligned with its white video flash').toBeLessThan(0.1)
    }
  }
  try {
    await docker('build', '-t', image, '-f', 'scripts/hls-media.Dockerfile', '.')
    await docker('network', 'create', network)
    await docker('run', '-d', '--rm', '--name', name, '--network', network, '--add-host', 'host.docker.internal:host-gateway',
      '-p', '127.0.0.1:19978:9997', '-p', '127.0.0.1:28891:8888',
      '-e', 'MTX_API=yes', '-e', 'MTX_AUTHMETHOD=http', '-e', `MTX_AUTHHTTPADDRESS=http://host.docker.internal:${port}/api/internal/mediamtx/authorize?secret=test-mtx-secret`,
      '-e', 'MTX_WEBRTCIPSFROMINTERFACESLIST=eth0', '-e', 'MTX_HLSALWAYSREMUX=yes', 'bluenviron/mediamtx:1.20.1')
    await until(async () => { try { return (await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/list`)).ok } catch { return false } })
    await docker('run', '-d', '--name', publisher, '--network', network, '--entrypoint', 'ffmpeg', image, '-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', "testsrc2=size=1920x1080:rate=60,drawbox=color=white:t=fill:enable='lt(mod(t,2),0.1)'", '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,2),0.1),0.3*sin(2*PI*440*t),0)':s=48000", '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'baseline', '-bf', '0', '-g', '120', '-b:v', '10000k', '-c:a', 'libopus', '-ar', '48000', '-ac', '2', '-f', 'whip', '-authorization', key.token, `http://${name}:8889/${channel.mediaPath}/whip`)
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
    await delay(12000)
    await assertAudioVideoSync(hls)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    await stop(worker)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true, tracks: expect.arrayContaining(['H264', 'Opus']) })
    await startWorker()
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return r.ok && (await r.json()).ready })
    await delay(12000)
    await assertAudioVideoSync(hls)
    // Simulate a key rotation whose best-effort Publisher disconnect failed.
    const rotatedKey = createOrRotateStreamKey('media-owner')
    await until(async () => { const r = await fetch(`${process.env.MEDIAMTX_API_URL}/v3/paths/get/${outputPath}`); return !r.ok || !(await r.json()).ready })
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: true })
    await stop(publisher)
    await until(async () => !(await getChannelStatus(channel.mediaPath)).live)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ live: false })
    // Switching back to the retained RTMP profile must use canonical AAC HLS,
    // without a stale WHIP conversion worker or an audio regression.
    await docker('run', '-d', '--name', publisher, '--network', network, '--entrypoint', 'ffmpeg', image,
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i',
      "testsrc2=size=640x360:rate=30,drawbox=color=white:t=fill:enable='lt(mod(t,2),0.1)'",
      '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,2),0.1),0.3*sin(2*PI*440*t),0)':s=48000",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-bf', '0', '-g', '60',
      '-b:v', '600k', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-f', 'flv',
      `rtmp://${name}:1935/${channel.mediaPath}?token=${rotatedKey.token}`)
    await until(async () => (await getChannelStatus(channel.mediaPath)).live)
    expect(await getChannelStatus(channel.mediaPath)).toMatchObject({ tracks: ['H264', 'MPEG-4 Audio'] })
    expect((await getChannelStatus(channel.mediaPath)).hlsMediaPath).toBeUndefined()
    expect(await (await GET(new Request('http://localhost/api/internal/hls-worker', { headers: { 'x-hls-worker-secret': process.env.HLS_WORKER_SECRET! } }))).json()).toEqual({ jobs: [] })
    await delay(12000)
    await assertAudioVideoSync(`http://127.0.0.1:28891/${channel.mediaPath}/index.m3u8`)
  } catch (error) {
    console.error(await docker('logs', name))
    console.error(await docker('logs', worker))
    throw error
  } finally {
    await stop(publisher)
    await stop(worker)
    for (const container of [publisher, worker, name]) {
      try { await docker('rm', '-f', container) } catch { /* Already removed. */ }
    }
    try { await docker('network', 'rm', network) } catch { /* Setup may have failed. */ }
    await new Promise<void>(resolve => server.close(() => resolve()))
    database.close()
    rmSync(captures, { recursive: true, force: true })
  }
}, 180000)
