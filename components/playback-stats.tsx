'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'

type PlaybackProtocol = 'WebRTC' | 'HLS'

interface PlaybackStatsProps {
  peerConnection?: RTCPeerConnection | null
  playing: boolean
  protocol: PlaybackProtocol
  tracks: string[]
  videoRef: RefObject<HTMLVideoElement | null>
}

interface PlaybackMetrics {
  audioCodec?: string
  bitrate?: number
  decodeTimeMs?: number
  droppedFrames?: number
  framePacing?: FramePacingSummary
  framesPerSecond?: number
  freezes?: number
  height?: number
  jitterBufferDelayMs?: number
  packetsLost?: number
  roundTripTime?: number
  videoCodec?: string
  width?: number
}

export interface FramePacingSample {
  mediaIntervalMs: number
  presentationIntervalMs: number
  presentationTime: number
  processingDurationMs?: number
}

export interface FramePacingSummary {
  decodeTimeMs?: number
  expectedFrameTimeMs?: number
  lateFrames: number
  mediaAverageMs?: number
  mediaP95Ms?: number
  presentationAverageMs?: number
  presentationIntervalsMs: number[]
  presentationP95Ms?: number
  sampleCount: number
}

interface SampleCursor {
  bytesReceived?: number
  framesDecoded?: number
  sampledAt: number
  videoBytesDecoded?: number
  videoFrames?: number
}

interface InboundRtpStats extends RTCStats {
  bytesReceived?: number
  codecId?: string
  framesDecoded?: number
  framesDropped?: number
  framesPerSecond?: number
  framesRendered?: number
  frameHeight?: number
  frameWidth?: number
  freezeCount?: number
  jitterBufferDelay?: number
  jitterBufferEmittedCount?: number
  kind?: string
  mediaType?: string
  packetsLost?: number
  totalDecodeTime?: number
}

interface CodecStats extends RTCStats {
  mimeType?: string
}

interface CandidatePairStats extends RTCStats {
  currentRoundTripTime?: number
  nominated?: boolean
  selected?: boolean
  state?: string
}

interface VideoWithWebkitMetrics extends HTMLVideoElement {
  webkitVideoDecodedByteCount?: number
}

interface FrameCallbackMetadata {
  expectedDisplayTime: number
  mediaTime: number
  presentationTime: number
  presentedFrames: number
  processingDuration?: number
}

type VideoWithFrameCallbacks = HTMLVideoElement & {
  cancelVideoFrameCallback?: (handle: number) => void
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: FrameCallbackMetadata) => void,
  ) => number
}

const audioTrackPattern = /audio|aac|opus|vorbis|g7|pcma|pcmu/i
const framePacingWindowMs = 10_000
const maximumFrameSamples = 720

function displayCodec(value: string): string {
  const codec = value.includes('/') ? value.split('/').at(-1) ?? value : value
  const normalized = codec.toLowerCase()

  if (normalized === 'av01') return 'AV1'
  if (normalized === 'avc1' || normalized === 'h264') return 'H.264'
  if (normalized === 'hevc' || normalized === 'h265' || normalized === 'hev1') {
    return 'HEVC'
  }
  if (normalized === 'mp4a-latm' || normalized === 'mpeg-4 audio') return 'AAC'

  return codec.toUpperCase()
}

function trackCodecs(tracks: string[]): Pick<PlaybackMetrics, 'audioCodec' | 'videoCodec'> {
  const audio = tracks.find((track) => audioTrackPattern.test(track))
  const video = tracks.find((track) => !audioTrackPattern.test(track))

  return {
    audioCodec: audio ? displayCodec(audio) : undefined,
    videoCodec: video ? displayCodec(video) : undefined,
  }
}

function formatBitrate(bitsPerSecond?: number): string {
  if (bitsPerSecond === undefined) return '—'
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bitsPerSecond / 1_000)} kbps`
}

function formatFrameRate(framesPerSecond?: number): string {
  if (framesPerSecond === undefined) return '—'
  return `${Math.round(framesPerSecond)} fps`
}

function formatResolution(width?: number, height?: number): string {
  if (!width || !height) return '—'
  return `${width}×${height}`
}

function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((total, value) => total + value, 0) / values.length
}

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index]
}

export function summarizeFramePacing(
  samples: readonly FramePacingSample[],
): FramePacingSummary {
  if (samples.length === 0) {
    return {
      lateFrames: 0,
      presentationIntervalsMs: [],
      sampleCount: 0,
    }
  }

  const newestPresentationTime = samples.at(-1)?.presentationTime ?? 0
  const recent = samples.filter(
    (sample) => sample.presentationTime >= newestPresentationTime - framePacingWindowMs,
  )
  const mediaIntervals = recent
    .map((sample) => sample.mediaIntervalMs)
    .filter((value) => Number.isFinite(value) && value > 0)
  const presentationIntervals = recent
    .map((sample) => sample.presentationIntervalMs)
    .filter((value) => Number.isFinite(value) && value > 0)
  const processingDurations = recent
    .map((sample) => sample.processingDurationMs)
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  const expectedFrameTimeMs = percentile(mediaIntervals, 0.5) ??
    percentile(presentationIntervals, 0.5)
  const lateThresholdMs = expectedFrameTimeMs === undefined
    ? undefined
    : expectedFrameTimeMs * 1.5

  return {
    decodeTimeMs: average(processingDurations),
    expectedFrameTimeMs,
    lateFrames: lateThresholdMs === undefined
      ? 0
      : presentationIntervals.filter((value) => value > lateThresholdMs).length,
    mediaAverageMs: average(mediaIntervals),
    mediaP95Ms: percentile(mediaIntervals, 0.95),
    presentationAverageMs: average(presentationIntervals),
    presentationIntervalsMs: presentationIntervals,
    presentationP95Ms: percentile(presentationIntervals, 0.95),
    sampleCount: presentationIntervals.length,
  }
}

function formatMilliseconds(value?: number, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)} ms`
}

function formatFrameTimes(averageMs?: number, p95Ms?: number): string {
  if (averageMs === undefined || p95Ms === undefined) return '—'
  return `${averageMs.toFixed(1)} / ${p95Ms.toFixed(1)} ms`
}

function FramePacingChart({ summary }: { summary?: FramePacingSummary }) {
  const intervals = summary?.presentationIntervalsMs ?? []
  if (intervals.length < 2) return <span className="playback-pacing-empty">—</span>

  const maximumPoints = 120
  const bucketSize = Math.max(1, Math.ceil(intervals.length / maximumPoints))
  const points: number[] = []
  for (let index = 0; index < intervals.length; index += bucketSize) {
    points.push(Math.max(...intervals.slice(index, index + bucketSize)))
  }

  const chartWidth = 160
  const chartHeight = 30
  const upperBoundMs = Math.max(50, percentile(points, 0.99) ?? 50)
  const path = points
    .map((value, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * chartWidth
      const y = chartHeight - Math.min(value, upperBoundMs) / upperBoundMs * chartHeight
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const expected = summary?.expectedFrameTimeMs
  const expectedY = expected === undefined
    ? undefined
    : chartHeight - Math.min(expected, upperBoundMs) / upperBoundMs * chartHeight

  return (
    <svg
      aria-label={`Presented frame times over ten seconds; average ${formatMilliseconds(summary?.presentationAverageMs)}, 95th percentile ${formatMilliseconds(summary?.presentationP95Ms)}`}
      className="playback-pacing-chart"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${chartWidth} ${chartHeight}`}
    >
      {expectedY !== undefined && (
        <line
          className="playback-pacing-target"
          x1="0"
          x2={chartWidth}
          y1={expectedY}
          y2={expectedY}
        />
      )}
      <path className="playback-pacing-line" d={path} />
    </svg>
  )
}

function getVideoQuality(video: HTMLVideoElement) {
  if (typeof video.getVideoPlaybackQuality !== 'function') return undefined
  return video.getVideoPlaybackQuality()
}

export function sumInboundPacketsLost(
  inbound: ReadonlyArray<Pick<InboundRtpStats, 'packetsLost'>>,
): number | undefined {
  let total = 0
  let reported = false

  for (const stream of inbound) {
    if (stream.packetsLost !== undefined) {
      total += stream.packetsLost
      reported = true
    }
  }

  return reported ? total : undefined
}

async function readMetrics(
  video: HTMLVideoElement,
  peerConnection: RTCPeerConnection | null | undefined,
  previous: SampleCursor | undefined,
): Promise<{ cursor: SampleCursor; metrics: PlaybackMetrics }> {
  const sampledAt = performance.now()
  const elapsedSeconds = previous ? (sampledAt - previous.sampledAt) / 1_000 : 0
  const quality = getVideoQuality(video)
  const webkitVideo = video as VideoWithWebkitMetrics
  const cursor: SampleCursor = {
    sampledAt,
    videoBytesDecoded: webkitVideo.webkitVideoDecodedByteCount,
    videoFrames: quality?.totalVideoFrames,
  }
  const metrics: PlaybackMetrics = {
    droppedFrames: quality?.droppedVideoFrames,
    height: video.videoHeight || undefined,
    width: video.videoWidth || undefined,
  }

  if (
    elapsedSeconds > 0 &&
    cursor.videoFrames !== undefined &&
    previous?.videoFrames !== undefined
  ) {
    metrics.framesPerSecond = Math.max(
      0,
      (cursor.videoFrames - previous.videoFrames) / elapsedSeconds,
    )
  }

  if (!peerConnection || peerConnection.connectionState === 'closed') {
    if (
      elapsedSeconds > 0 &&
      cursor.videoBytesDecoded !== undefined &&
      previous?.videoBytesDecoded !== undefined
    ) {
      metrics.bitrate = Math.max(
        0,
        ((cursor.videoBytesDecoded - previous.videoBytesDecoded) * 8) / elapsedSeconds,
      )
    }
    return { cursor, metrics }
  }

  const report = await peerConnection.getStats()
  const codecs = new Map<string, CodecStats>()
  const inbound: InboundRtpStats[] = []
  let roundTripTime: number | undefined

  report.forEach((stat) => {
    if (stat.type === 'codec') codecs.set(stat.id, stat as CodecStats)
    if (stat.type === 'inbound-rtp') inbound.push(stat as InboundRtpStats)

    if (stat.type === 'candidate-pair') {
      const pair = stat as CandidatePairStats
      if (
        pair.state === 'succeeded' &&
        (pair.nominated || pair.selected) &&
        pair.currentRoundTripTime !== undefined
      ) {
        roundTripTime = pair.currentRoundTripTime
      }
    }
  })

  let totalBytesReceived = 0
  let videoFramesDecoded: number | undefined

  for (const stream of inbound) {
    const kind = stream.kind ?? stream.mediaType
    totalBytesReceived += stream.bytesReceived ?? 0
    const codec = stream.codecId ? codecs.get(stream.codecId)?.mimeType : undefined

    if (kind === 'video') {
      if (codec) metrics.videoCodec = displayCodec(codec)
      metrics.width = stream.frameWidth ?? metrics.width
      metrics.height = stream.frameHeight ?? metrics.height
      metrics.framesPerSecond = stream.framesPerSecond ?? metrics.framesPerSecond
      metrics.droppedFrames = stream.framesDropped ?? metrics.droppedFrames
      metrics.freezes = stream.freezeCount
      if (
        stream.jitterBufferDelay !== undefined &&
        stream.jitterBufferEmittedCount !== undefined &&
        stream.jitterBufferEmittedCount > 0
      ) {
        metrics.jitterBufferDelayMs =
          stream.jitterBufferDelay / stream.jitterBufferEmittedCount * 1_000
      }
      if (
        stream.totalDecodeTime !== undefined &&
        stream.framesDecoded !== undefined &&
        stream.framesDecoded > 0
      ) {
        metrics.decodeTimeMs = stream.totalDecodeTime / stream.framesDecoded * 1_000
      }
      videoFramesDecoded = stream.framesDecoded
    }

    if (kind === 'audio' && codec) metrics.audioCodec = displayCodec(codec)
  }

  cursor.bytesReceived = totalBytesReceived
  cursor.framesDecoded = videoFramesDecoded
  metrics.packetsLost = sumInboundPacketsLost(inbound)
  metrics.roundTripTime = roundTripTime

  if (
    elapsedSeconds > 0 &&
    previous?.bytesReceived !== undefined &&
    totalBytesReceived >= previous.bytesReceived
  ) {
    metrics.bitrate = ((totalBytesReceived - previous.bytesReceived) * 8) / elapsedSeconds
  }

  if (
    metrics.framesPerSecond === undefined &&
    elapsedSeconds > 0 &&
    videoFramesDecoded !== undefined &&
    previous?.framesDecoded !== undefined
  ) {
    metrics.framesPerSecond = Math.max(
      0,
      (videoFramesDecoded - previous.framesDecoded) / elapsedSeconds,
    )
  }

  return { cursor, metrics }
}

export function PlaybackStats({
  peerConnection,
  playing,
  protocol,
  tracks,
  videoRef,
}: PlaybackStatsProps) {
  const fallbackCodecs = useMemo(() => trackCodecs(tracks), [tracks])
  const [metrics, setMetrics] = useState<PlaybackMetrics>(fallbackCodecs)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playing) {
      setMetrics(fallbackCodecs)
      return
    }

    let active = true
    let previous: SampleCursor | undefined
    const frameVideo = video as VideoWithFrameCallbacks
    const frameSamples: FramePacingSample[] = []
    let frameCallbackHandle: number | undefined
    let previousMediaTime: number | undefined
    let previousPresentationTime: number | undefined
    let previousPresentedFrames: number | undefined

    const resetFramePacing = () => {
      frameSamples.length = 0
      previousMediaTime = undefined
      previousPresentationTime = undefined
      previousPresentedFrames = undefined
    }

    const scheduleFrameCallback = () => {
      if (!active || !frameVideo.requestVideoFrameCallback) return
      frameCallbackHandle = frameVideo.requestVideoFrameCallback((_now, metadata) => {
        frameCallbackHandle = undefined
        if (!active) return

        if (document.visibilityState !== 'visible') {
          resetFramePacing()
          scheduleFrameCallback()
          return
        }

        const mediaIntervalMs = previousMediaTime === undefined
          ? undefined
          : (metadata.mediaTime - previousMediaTime) * 1_000
        const presentationIntervalMs = previousPresentationTime === undefined
          ? undefined
          : metadata.presentationTime - previousPresentationTime
        const presentedFrameDelta = previousPresentedFrames === undefined
          ? undefined
          : metadata.presentedFrames - previousPresentedFrames

        if (
          mediaIntervalMs !== undefined &&
          presentationIntervalMs !== undefined &&
          mediaIntervalMs > 0 &&
          presentationIntervalMs > 0 &&
          presentedFrameDelta === 1
        ) {
          frameSamples.push({
            mediaIntervalMs,
            presentationIntervalMs,
            presentationTime: metadata.presentationTime,
            processingDurationMs: metadata.processingDuration === undefined
              ? undefined
              : metadata.processingDuration * 1_000,
          })
          if (frameSamples.length > maximumFrameSamples) {
            frameSamples.splice(0, frameSamples.length - maximumFrameSamples)
          }
        }

        previousMediaTime = metadata.mediaTime
        previousPresentationTime = metadata.presentationTime
        previousPresentedFrames = metadata.presentedFrames
        scheduleFrameCallback()
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetFramePacing()
    }

    const update = async () => {
      try {
        const sample = await readMetrics(video, peerConnection, previous)
        previous = sample.cursor
        if (active) {
          const framePacing = summarizeFramePacing(frameSamples)
          setMetrics({
            ...fallbackCodecs,
            ...sample.metrics,
            audioCodec: sample.metrics.audioCodec ?? fallbackCodecs.audioCodec,
            decodeTimeMs: framePacing.decodeTimeMs ?? sample.metrics.decodeTimeMs,
            framePacing,
            videoCodec: sample.metrics.videoCodec ?? fallbackCodecs.videoCodec,
          })
        }
      } catch {
        // A closed/restarting peer connection is expected during recovery.
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    scheduleFrameCallback()
    void update()
    const timer = window.setInterval(() => void update(), 1_000)

    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (
        frameCallbackHandle !== undefined &&
        typeof frameVideo.cancelVideoFrameCallback === 'function'
      ) {
        frameVideo.cancelVideoFrameCallback(frameCallbackHandle)
      }
    }
  }, [fallbackCodecs, peerConnection, playing, videoRef])

  const codecs = [metrics.videoCodec, metrics.audioCodec].filter(Boolean).join(' · ')
  const connection = playing ? 'Playing' : 'Waiting'

  return (
    <div
      aria-label="Playback diagnostics"
      className="playback-stats"
      title="Viewer-side playback measurements"
    >
      <div className="playback-stat">
        <span>Mode</span>
        <strong>{protocol}</strong>
      </div>
      <div className="playback-stat">
        <span>Codecs</span>
        <strong>{codecs || '—'}</strong>
      </div>
      <div className="playback-stat">
        <span>Resolution</span>
        <strong>{formatResolution(metrics.width, metrics.height)}</strong>
      </div>
      <div className="playback-stat">
        <span>Frame rate</span>
        <strong>{formatFrameRate(metrics.framesPerSecond)}</strong>
      </div>
      <div
        className="playback-stat playback-stat-pacing-chart"
        title="Rolling browser presentation intervals; spikes indicate uneven pacing"
      >
        <span>Frame pacing · 10s</span>
        <strong>
          <FramePacingChart summary={metrics.framePacing} />
        </strong>
      </div>
      <div
        className="playback-stat"
        title="Average / 95th-percentile frame timestamp interval encoded in the stream"
      >
        <span>Source frame</span>
        <strong>
          {formatFrameTimes(
            metrics.framePacing?.mediaAverageMs,
            metrics.framePacing?.mediaP95Ms,
          )}
        </strong>
      </div>
      <div
        className="playback-stat"
        title="Average / 95th-percentile interval between frames submitted for browser composition"
      >
        <span>Presented frame</span>
        <strong>
          {formatFrameTimes(
            metrics.framePacing?.presentationAverageMs,
            metrics.framePacing?.presentationP95Ms,
          )}
        </strong>
      </div>
      <div
        className="playback-stat"
        title="Presented intervals longer than 1.5 times the rolling median source interval"
      >
        <span>Late frames</span>
        <strong>
          {metrics.framePacing?.sampleCount
            ? `${metrics.framePacing.lateFrames} / ${metrics.framePacing.sampleCount}`
            : '—'}
        </strong>
      </div>
      <div className="playback-stat" title="Average decoder and video processing time per frame">
        <span>Decode/process</span>
        <strong>{formatMilliseconds(metrics.decodeTimeMs)}</strong>
      </div>
      <div
        className="playback-stat"
        title="Average WebRTC jitter-buffer delay per emitted frame"
      >
        <span>Jitter buffer</span>
        <strong>{formatMilliseconds(metrics.jitterBufferDelayMs)}</strong>
      </div>
      <div className="playback-stat" title="WebRTC receiver-reported video freezes">
        <span>Freezes</span>
        <strong>{metrics.freezes === undefined ? '—' : metrics.freezes.toLocaleString()}</strong>
      </div>
      <div className="playback-stat">
        <span>Received</span>
        <strong>{formatBitrate(metrics.bitrate)}</strong>
      </div>
      <div className="playback-stat">
        <span>Dropped</span>
        <strong>
          {metrics.droppedFrames === undefined ? '—' : metrics.droppedFrames.toLocaleString()}
        </strong>
      </div>
      <div className="playback-stat">
        <span>Packets lost</span>
        <strong>
          {metrics.packetsLost === undefined ? '—' : metrics.packetsLost.toLocaleString()}
        </strong>
      </div>
      <div className="playback-stat">
        <span>Network RTT</span>
        <strong>
          {metrics.roundTripTime === undefined
            ? '—'
            : `${Math.round(metrics.roundTripTime * 1_000)} ms`}
        </strong>
      </div>
      <div className="playback-stat playback-stat-state">
        <span>Status</span>
        <strong>
          <i data-playing={playing} aria-hidden="true" />
          {connection}
        </strong>
      </div>
    </div>
  )
}
