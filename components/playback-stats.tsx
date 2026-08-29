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
  droppedFrames?: number
  framesPerSecond?: number
  height?: number
  roundTripTime?: number
  videoCodec?: string
  width?: number
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
  frameHeight?: number
  frameWidth?: number
  kind?: string
  mediaType?: string
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

const audioTrackPattern = /audio|aac|opus|vorbis|g7|pcma|pcmu/i

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

function getVideoQuality(video: HTMLVideoElement) {
  if (typeof video.getVideoPlaybackQuality !== 'function') return undefined
  return video.getVideoPlaybackQuality()
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
      videoFramesDecoded = stream.framesDecoded
    }

    if (kind === 'audio' && codec) metrics.audioCodec = displayCodec(codec)
  }

  cursor.bytesReceived = totalBytesReceived
  cursor.framesDecoded = videoFramesDecoded
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

    const update = async () => {
      try {
        const sample = await readMetrics(video, peerConnection, previous)
        previous = sample.cursor
        if (active) {
          setMetrics({
            ...fallbackCodecs,
            ...sample.metrics,
            audioCodec: sample.metrics.audioCodec ?? fallbackCodecs.audioCodec,
            videoCodec: sample.metrics.videoCodec ?? fallbackCodecs.videoCodec,
          })
        }
      } catch {
        // A closed/restarting peer connection is expected during recovery.
      }
    }

    void update()
    const timer = window.setInterval(() => void update(), 1_000)

    return () => {
      active = false
      window.clearInterval(timer)
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
