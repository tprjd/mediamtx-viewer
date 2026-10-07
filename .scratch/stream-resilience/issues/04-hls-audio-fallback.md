# 04: Fall back to HLS with sound

**What to build:** When WebRTC cannot play an eligible WHIP-published Channel,
the viewer automatically continues through smooth HLS with synchronized video
and sound. The Channel remains one Channel with correct access, viewer counts,
and live notifications.

**Blocked by:** None (can start immediately with the existing WHIP prototype).

**Status:** ready-for-agent

Type: task
Spec: [Managed OBS WHIP streaming](../spec.md)

- [ ] Use one supervised converter per active eligible pilot WHIP source. Copy
  H.264 video and convert Opus to AAC only for the HLS derivative. WebRTC receives
  the original media without conversion. Do not start a converter per viewer.
- [ ] Prepare derivative HLS when the canonical source becomes ready. A viewer
  entering HLS selects the AAC derivative directly, including after WebRTC failure.
  Verify video, audible sound, and synchronization in the actual application.
- [ ] Force viewer WebRTC failure while the source remains live and verify
  automatic smooth HLS playback with a visible Playback mode indication.
- [ ] Remain on HLS after fallback. Allow manual WebRTC selection after the
  existing 60-second cooldown; expiry alone does not switch playback.
- [ ] Enforce the original Channel's Viewing access on HLS playlists and segments
  through both production and direct application proxies. Preserve Viewer identity
  query parameters and enforce revocation and Account suspension.
- [ ] Permit derivative publishing only with a separately scoped internal worker
  credential. Reject external derivative publishing, worker publishing to the
  canonical source, and viewer WHEP sessions on the derivative.
- [ ] Count one watch visit once across WebRTC and HLS in both Channel detail and
  directory status. An internal worker with no viewers counts zero viewers.
- [ ] Keep canonical source tracks, live state, start time, notifications, and
  thumbnails unchanged by derivative startup or restart.
- [ ] Bind workers to the current source generation. Stop stale workers and media
  after source end, replacement, profile switch to RTMP, key revocation, or loss
  of Streaming access. Prevent derivative loops and duplicate workers.
- [ ] Verify bounded worker restart after a crash or MediaMTX restart. A converter
  failure does not interrupt healthy WebRTC playback. Clear stale derivative
  routing when the Channel resumes RTMP publishing.
- [ ] Demonstrate the behavior with real media, supported by existing access,
  authorization, and reader-count integration tests. Preserve existing RTMP HLS
  behavior. Ticket 07 performs the final physical iPhone and OCI acceptance run.

## Independent verification

Use the existing H.264 and Opus WHIP Publisher and the real viewer. Final video
bitrate selection and Managed OBS profile generation do not gate audio fallback.
Compare observed source and derivative codecs, playback, access results, viewer
counts, and lifecycle behavior rather than only generated configuration.

## Comments

MediaMTX HLS Opus support does not establish Safari compatibility. The planned
fallback copies video and converts audio once per active Channel, not per viewer.

2026-10-07: Approved as an independent vertical slice with no blockers.
The earlier dependency on ticket 03 is removed because the existing WHIP
prototype supplies suitable media. Audio conversion serves HLS fallback only.
