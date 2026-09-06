// WebRTC/WHEP availability from the published track set.
//
// MediaMTX 1.20's WHEP transport carries Opus audio and H264/H265/AV1 video
// over RTP. A source with AAC (or any non-Opus audio codec) cannot be played
// over WebRTC without server-side transcoding, so the low-latency WebRTC mode
// is unavailable for those streams.

const VIDEO_TRACK_PATTERN = /^H264$|^H265$|^HEVC$|^AV1$/i
const OPUS_TRACK_PATTERN = /^opus$/i
const AUDIO_TRACK_PATTERN = /audio|aac|opus|g7|vorbis|pcma|pcmu/i

export function hasVideoTrack(tracks: readonly string[]): boolean {
  return tracks.some((track) => VIDEO_TRACK_PATTERN.test(track.trim()))
}

export function hasAudioTrack(tracks: readonly string[]): boolean {
  return tracks.some((track) => AUDIO_TRACK_PATTERN.test(track.trim()))
}

export function isWebRtcVideoSupported(tracks: readonly string[]): boolean {
  return hasVideoTrack(tracks)
}

export function isWebRtcAudioSupported(tracks: readonly string[]): boolean {
  const audioTracks = tracks.filter((track) => AUDIO_TRACK_PATTERN.test(track.trim()))
  // No audio track at all -> video-only WebRTC is acceptable.
  if (audioTracks.length === 0) return true
  return audioTracks.every((track) => OPUS_TRACK_PATTERN.test(track.trim()))
}

export function isWebRtcAvailable(tracks: readonly string[]): boolean {
  return isWebRtcVideoSupported(tracks) && isWebRtcAudioSupported(tracks)
}

export function webrtcUnavailableReason(tracks: readonly string[]): string | undefined {
  if (isWebRtcAvailable(tracks)) return undefined
  if (!isWebRtcVideoSupported(tracks)) {
    return 'Low latency is not available for this stream\'s video codec.'
  }
  return 'Low latency is not available for this stream\'s audio codec.'
}
