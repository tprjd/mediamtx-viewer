import { mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const supportedPathPattern = /^(?:live|channels\/[a-z0-9]+(?:-[a-z0-9]+)*)$/
const thumbnailQuery = 'frankerzspam_internal=thumbnail'

export function thumbnailFileName(mediaPath) {
  return `${encodeURIComponent(mediaPath)}.jpg`
}

export function isSupportedMediaPath(mediaPath) {
  return supportedPathPattern.test(mediaPath)
}

export function activePathsFromPayload(payload) {
  if (!payload || !Array.isArray(payload.items)) return []
  return payload.items
    .filter(
      (item) =>
        item &&
        typeof item.name === 'string' &&
        isSupportedMediaPath(item.name) &&
        (item.ready ?? item.available ?? item.online ?? false),
    )
    .map((item) => item.name)
}

export function encodedMediaPath(mediaPath) {
  return mediaPath.split('/').map(encodeURIComponent).join('/')
}

export function ffmpegArguments(mediaPath, temporaryPath, hlsOrigin) {
  return [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-max_error_rate',
    '1.0',
    '-user_agent',
    'FrankerzSpamThumbnailer/1.0',
    '-i',
    `${hlsOrigin.replace(/\/$/, '')}/${encodedMediaPath(mediaPath)}/index.m3u8?${thumbnailQuery}`,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2',
    '-q:v',
    '5',
    '-y',
    temporaryPath,
  ]
}

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function listActivePaths(apiOrigin) {
  const response = await fetch(`${apiOrigin.replace(/\/$/, '')}/v3/paths/list`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`MediaMTX returned HTTP ${response.status}`)
  return activePathsFromPayload(await response.json())
}

async function runFfmpeg(arguments_, timeoutMilliseconds) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', arguments_, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4_000) stderr += chunk.toString()
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMilliseconds)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else {
        reject(
          new Error(
            `FFmpeg exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
          ),
        )
      }
    })
  })
}

async function captureThumbnail({
  mediaPath,
  outputDirectory,
  hlsOrigin,
  timeoutMilliseconds,
}) {
  const filename = thumbnailFileName(mediaPath)
  const destination = path.join(outputDirectory, filename)
  const temporary = path.join(
    outputDirectory,
    `.${filename}.${process.pid}.${Date.now()}.tmp.jpg`,
  )
  try {
    await runFfmpeg(
      ffmpegArguments(mediaPath, temporary, hlsOrigin),
      timeoutMilliseconds,
    )
    await rename(temporary, destination)
    console.log(`Updated thumbnail for ${mediaPath}`)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function runThumbnailWorker() {
  const apiOrigin = process.env.MEDIAMTX_API_URL ?? 'http://mediamtx:9997'
  const hlsOrigin = process.env.MEDIAMTX_HLS_URL ?? 'http://mediamtx:8888'
  const outputDirectory = process.env.THUMBNAIL_DIR ?? '/thumbnails'
  const intervalMilliseconds =
    positiveInteger(process.env.THUMBNAIL_INTERVAL_SECONDS, 180) * 1_000
  const initialDelayMilliseconds =
    positiveInteger(process.env.THUMBNAIL_INITIAL_DELAY_SECONDS, 5, 0) * 1_000
  const pollMilliseconds =
    positiveInteger(process.env.THUMBNAIL_POLL_SECONDS, 5) * 1_000
  const retryMilliseconds =
    positiveInteger(process.env.THUMBNAIL_RETRY_SECONDS, 20) * 1_000
  const timeoutMilliseconds =
    positiveInteger(process.env.THUMBNAIL_CAPTURE_TIMEOUT_SECONDS, 25) * 1_000

  await mkdir(outputDirectory, { recursive: true })
  const nextCapture = new Map()
  let stopping = false
  let apiFailureLogged = false
  process.on('SIGINT', () => {
    stopping = true
  })
  process.on('SIGTERM', () => {
    stopping = true
  })

  console.log(
    `Thumbnail worker ready; first frame after ${initialDelayMilliseconds / 1_000}s, refresh every ${intervalMilliseconds / 1_000}s`,
  )

  while (!stopping) {
    try {
      const activePaths = await listActivePaths(apiOrigin)
      if (apiFailureLogged) console.log('MediaMTX API connection restored')
      apiFailureLogged = false
      const activeSet = new Set(activePaths)
      for (const mediaPath of nextCapture.keys()) {
        if (!activeSet.has(mediaPath)) nextCapture.delete(mediaPath)
      }

      const now = Date.now()
      for (const mediaPath of activePaths) {
        if (!nextCapture.has(mediaPath)) {
          nextCapture.set(mediaPath, now + initialDelayMilliseconds)
        }
      }

      for (const mediaPath of activePaths) {
        if ((nextCapture.get(mediaPath) ?? Infinity) > Date.now()) continue
        try {
          await captureThumbnail({
            mediaPath,
            outputDirectory,
            hlsOrigin,
            timeoutMilliseconds,
          })
          nextCapture.set(mediaPath, Date.now() + intervalMilliseconds)
        } catch (error) {
          console.error(
            `Thumbnail capture failed for ${mediaPath}: ${error instanceof Error ? error.message : 'unknown error'}`,
          )
          nextCapture.set(mediaPath, Date.now() + retryMilliseconds)
        }
      }
    } catch (error) {
      if (!apiFailureLogged) {
        console.error(
          `MediaMTX status unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
        )
        apiFailureLogged = true
      }
    }

    if (!stopping) await sleep(pollMilliseconds)
  }
}

const executedPath = process.argv[1]
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  runThumbnailWorker().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
