# Adaptive playback UX plan (WebRTC availability grey-out + forgiving HLS ≤3s)

Status: implemented (see commit for the adaptive-playback change).

## Problem statement (verified against the deployed stack)

Two playback-availability gaps surfaced while testing the new RTMP/WHIP
ingest:

1. **WebRTC "Low latency" is selectable even when the current stream cannot
   sustain it.** The button is gated only by `!live || retrySeconds > 0`
   (`components/use-playback-mode.ts`), not by whether WHEP can actually
   carry the source. RTMP ingest publishes AAC; MediaMTX 1.20's WHEP/WebRTC
   transport only supports Opus audio, so an RTMP+AAC source gives a broken
   first-run WebRTC experience (silent/failing audio) instead of a clear
   unavailable state.

2. **HLS ≤3s hard-demotes when the stream's real segment duration exceeds the
   contract's 2s.** The current packaging guard (`components/hls-player.tsx`,
   fixed to use `averagetargetduration`) requires `measuredSegment <= 2.0s`
   and calls `onUltraLowUnavailable` otherwise. A live WHIP stream with
   4.167 s segments (GOP 250 frames @ 60 fps) therefore snaps to Balanced
   instead of holding the best latency that stream can support.

## Goals

- WebRTC Low latency appears **greyed out** with a reason when the source
  cannot support it (not just when offline / on cooldown).
- HLS ≤3s **strives for the lowest latency possible on the current stream**
  rather than issuing a binary pass/fail at exactly 2.0 s segments, and only
  demotes on real instability (repeated stalls/recoveries).

## Design

### A) WebRTC availability (grey-out)

- Derive `webrtcAvailable` from the live source's tracks (`channel.status.tracks`):
  WebRTC/WHEP is viable when the audio is **Opus** (or absent) and video is
  H264/H265/AV1. If the audio track is **AAC** (RTMP ingest) or non-WebRTC,
  mark WebRTC unavailable.
- Wire `webrtcAvailable` into `usePlaybackMode`, computed from
  `channel.status.tracks` (not just `live`).
- Button: `disabled={!webrtcAvailable || lowLatencyDisabled}`, with a reason
  title: "Not available for the current stream's audio codec" vs the existing
  "retry in Ns" / "offline" reasons.
- If the viewer is currently in WebRTC and the tracks change to make it
  invalid, fall back to Balanced via the existing `onWebRtcFallback` path.
- Recommendation: **grey it out** rather than offering silent video-only
  WebRTC — a clear "not available" is a better failure than muted playback.

### B) HLS ≤3s forgiveness (segment-aware target)

Replace the binary packaging guard with a bounded, per-stream latency target:

- Hard rule (unchanged / non-negotiable): **parts ≤ 250 ms** (LL-HLS needs
  small parts; contract is 200 ms).
- Segment rule becomes an **adaptive target** instead of a pass/fail:
  - `avgSeg <= 2.0 s`  -> target ≈ 1.8 s (current ultra-low, unchanged)
  - `avgSeg <= 4.0 s`  -> target ≈ 3.0–3.5 s (keeps your 4.167 s WHIP
    stream in the low-latency mode instead of demoting)
  - `avgSeg > 4.0 s`   -> target ≈ 4.0–5.0 s (approaching Balanced's 5.0 s)
- In the player, when the packaging guard previously fired
  `onUltraLowUnavailable`, instead **re-aim** the profile's
  `liveSyncDuration` / `liveMaxLatencyDuration` / `maxBufferLength` to the
  achievable target and keep playing in the low-latency mode. Demote only if
  even the loosened target cannot be met (repeated stalls/instability).

### C) Streaming contract

Extend the ultra-low mode with an adaptive ceiling rather than a single one:

```json
"ultra-low": {
  "targetLatencyMs": 1800,
  "correctiveLatencyCeilingMs": 3000,
  "forwardBufferCeilingMs": 3000,
  "maxBufferLengthMs": 2000,
  "adaptiveMaxSegmentMs": 4000
}
```

with a helper that maps measured segment duration -> effective target, used
by the player to set `liveSyncDuration` / `liveMaxLatencyDuration` /
`maxBufferLength`.

## Files touched

- `components/use-playback-mode.ts` — add `webrtcAvailable` from tracks; gate
  the button.
- `components/live-player.tsx` — pass `webrtcAvailable`; grey the button with
  a reason title.
- `components/hls-player.tsx` — segment-aware target selection in the
  packaging guard + SLO; only demote on true instability.
- `config/streaming-contract.v1.json` —
  `lib/streaming-contract-core.ts` — `lib/streaming-contract.ts` — add
  `adaptiveMaxSegmentMs` and the segment->target helper.
- Tests: tracks-gating (Opus vs AAC), segment-adaptive target (2 s -> 1.8 s,
  4.167 s -> ~3.5 s, 6 s -> ~4.5 s), WebRTC fallback when tracks change.

## Open questions

1. **Label**: with forgiving targets, "HLS ≤3s" is misleading for 4–5 s
   streams. Rename to "Low (best-possible)" or keep dynamic ("HLS ≈3-4s")?
2. **WebRTC audio**: when tracks are AAC, grey the button (recommended) or
   offer silent video-only WebRTC?
3. **AAC -> Opus for WHEP**: still want to explore server-side transcoding
   (previously out of scope), or accept the RTMP => WebRTC limitation and
   rely on the grey-out? Recommend: accept the limitation for now.

## Resolved decisions (grill/check)

- **Q1 (label)**: rename the mode from "HLS ≤3s" to **"Low (best-possible)"** so
  the label is honest for 2s / 4s / 5s streams. The underlying contract
  `targetLatencyMs` / `correctiveLatencyCeilingMs` remain the adaptive values.
- **Q2 (WebRTC audio)**: **grey out** WebRTC Low latency when the source
  audio is AAC / not Opus. No silent video-only WebRTC offering.
- **Q3 (transcoding)**: **no** AAC -> Opus / server-side transcoding. Accept
  the RTMP => WebRTC audio limitation; WebRTC Low latency is available for
  Opus sources (WHIP) and greyed out for AAC sources (RTMP).

## Implementation order

1. Contract: add `adaptiveMaxSegmentMs` + segment->target helper (+ tests).
2. `use-playback-mode.ts`: `webrtcAvailable` from tracks; gate button +
   reasons; WebRTC fallback on track change.
3. `live-player.tsx`: grey-out button with reason + "Low (best-possible)"
   label.
4. `hls-player.tsx`: segment-aware target (re-aim instead of demote); demote
   only on real instability.
5. Tests for all three behaviors; run typecheck / lint / tests / build;
   commit; deploy.

## Locked decisions (grill rounds 1-3)

### Round 1 — foundation
- **Q1**: Gate WebRTC availability from `channel.status.tracks` (not source
  type); track names already disambiguate Opus vs AAC. `ChannelStatus` exposes
  only `tracks`, and the existing `sourceHasAudio` regex
  (`components/webrtc-player.tsx:115`) already classifies
  `aac|opus|g7|vorbis|pcma|pcmu`.
- **Q2**: Allow **video-only** WebRTC (no audio track is not a failure). Grey
  only when audio exists and is not Opus.
- **Q3**: Scale **both** `liveSyncDuration` and `liveMaxLatencyDuration`
  (and the forward-buffer cap) from the same segment-derived multiplier, so a
  4.167 s stream does not constantly breach a fixed 3.0 s ceiling. One helper
  maps `avgSeg -> (target, ceiling, buffer)`.
- **Q4**: Demote only when latency exceeds the **adaptive ceiling** for a
  sustained window AND a corrective seek does not recover. A 3.5 s actual on
  a 4.167 s stream is within tolerance (strive for lowest possible).
- **Q5**: Keep the internal enum `'ultra-low'` (no storage migration); change
  every user-facing string to "Low (best-possible)".
- **Q6**: If `preferredPlayback === 'webrtc'` but WebRTC is unavailable, start
  in Balanced.

### Round 2 — mechanics of the adaptive HLS target
- **Q7**: Measure from `averagetargetduration` (stable, deterministic, lags a
  few segments; acceptable since GOP does not change mid-stream).
- **Q8**: Re-evaluate on every `LEVEL_UPDATED`, with the same cooldown as
  corrective seeks, so a streamer switching keyframes mid-stream is followed.
- **Q9**: Scale the forward-buffer **breach threshold** together with the load
  cap (no fixed 3.0 s) to avoid reintroducing the cap==breach bug.
  `forwardBufferCeilingMs` becomes the base that scales with segment size.
- **Q10**: `audioTrack === 'Opus' || no audio -> available`, else grey.
  Reuse the `sourceHasAudio` classification.
- **Q11**: Surface the reason via `disabled` + `title`/`aria-label` only.
- **Q12**: On `preferredPlayback === 'webrtc'` unavailable, write `balanced`
  to the mode-storage key (persists degradation) and set `modeExitReason`.

### Round 3 — final implementation details
- **Q13**: Extract a shared pure helper `isWebRtcAvailable(tracks)` (e.g.
  `lib/playback-availability.ts`), single source of truth used by both
  `usePlaybackMode` and `webrtc-player`.
- **Q14**: Adaptive scaling formula (parts <= 250 ms must hold; target rounded
  to 2 decimals):
  - `s <= 2.0`: target 1.8, ceiling 3.0, buffer 2.0 (unchanged ultra-low).
  - `2.0 < s <= 4.0`: target `s * 0.8`, ceiling `s * 1.05`, buffer `s * 0.875`
    (e.g. 3.5 -> 2.8 / 3.68 / 3.06). 4.167 lands in the >4s bucket.
  - `s > 4.0`: target `ceil(s)`, ceiling `ceil(s) + 1`, buffer `ceil(s) - 0.25`
    (4.167 -> 5.0 / 6.0 / 4.75; 5.0 -> 5.0 / 6.0 / 4.75; 6.0 -> 6.0 / 7.0 / 5.75).
  - `s > 4.0`: target `ceil(s)`, ceiling `ceil(s) + 1`, buffer
    `ceil(s) - 0.25` (5.0 -> 5.0 / 6.0 / 4.75; 6.0 -> 6.0 / 7.0 / 5.75).
- **Q15**: Apply the adaptive target to **ultra-low only**; Balanced/Smooth
  keep fixed tradeoffs.
- **Q16**: Extend the existing test files (`streaming-contract.test.ts`,
  `hls-player.test.tsx`, `webrtc-player.test.tsx`) with the test vectors from
  Q14 and the `isWebRtcAvailable` cases; no new test files.
- **Q17**: Diagnostics panel shows the **effective** (scaled) target/ceiling/
  buffer plus the measured `averagetargetduration`, so the "why ~3.3s" is
  visible.
- **Q18**: Set the contract `label` to `Low (best-possible)`; every
  button/badge/message derives from it. Internal `'ultra-low'` key, storage,
  and tests stay unchanged.

## Final implementation surface

- `lib/playback-availability.ts` (new): `isWebRtcAvailable(tracks)` +
  `webrtcUnavailableReason(tracks)`.
- `lib/streaming-contract-core.ts` / `lib/streaming-contract.ts`: adaptive
  helper `adaptiveLatencyProfile(avgSegmentSeconds)` returning
  `(target, ceiling, buffer)`; contract label -> "Low (best-possible)".
- `components/use-playback-mode.ts`: `webrtcAvailable` from tracks; gate
  button; `preferredPlayback` fallback to Balanced (persisted); WebRTC
  fallback on track change.
- `components/live-player.tsx`: grey-out button + `title`/`aria-label`;
  label from contract.
- `components/hls-player.tsx`: re-aim on `LEVEL_UPDATED` via the adaptive
  helper (ultra-low only); demote only on sustained ceiling breach +
  non-recovery; diagnostics show effective values.
- `components/webrtc-player.tsx`: reuse `isWebRtcAvailable`.
- Tests in the existing three files per Q14/Q16 vectors.
