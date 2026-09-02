# Two-keyframe low-latency HLS

Status: implemented in source on 2026-09-02. Production deployment and live
playlist verification are pending.

This change replaces the experimental `HLS ≤2s` budget from
`docs/two-second-ll-hls-plan.md`. The new profile favors continuity over the
smallest possible latency.

## Accepted design

- Keep the managed OBS keyframe interval at one second.
- Change MediaMTX from one-second to two-second HLS segments.
- Keep LL-HLS parts at 200 ms.
- Replace `HLS ≤2s` with `HLS ≤3s`; do not add a fifth playback mode.
- Keep the `ultra-low` internal mode name and saved preference for compatibility.
- Keep the existing two-instabilities-in-30-seconds fallback to Balanced.

The resulting profile is:

| Setting | Previous | Current |
| --- | ---: | ---: |
| `hlsSegmentDuration` | 1 s | 2 s |
| `hlsPartDuration` | 200 ms | 200 ms |
| `liveSyncDuration` | 1.2 s | 1.8 s |
| `liveMaxLatencyDuration` | 2 s | 3 s |
| `maxBufferLength` | 1.8 s | 3 s |
| `maxMaxBufferLength` | 1.8 s | 3 s |
| `forwardBufferLimit` | 2 s | 3 s |
| `backBufferLength` | 0 s | 0 s |

Balanced, Smooth, and WebRTC settings do not change. Balanced and Smooth use
the global two-second HLS segments.

## Review corrections

The original plan overstated three effects:

- A two-second segment normally contains two periodic keyframes with a
  one-second OBS GOP. Encoder behavior and boundary timing can add or shift a
  keyframe, so two is the nominal count rather than an unconditional guarantee.
- A 3 s buffer at 12 Mbps contains about 4.5 MB of video, not 5.4 MB.
- Two-second segments halve completed-segment publication cadence. They do not
  halve total LL-HLS request cadence because 200 ms part delivery is unchanged.

The resilience gain comes mainly from the larger latency and forward-buffer
budgets. The longer completed segments reduce packaging churn but are not a
substitute for the larger buffer.

## Implementation

- `components/hls-player.tsx` applies the 1.8 s sync target, 3 s limits, and
  two-second playlist contract.
- `components/live-player.tsx` displays the `HLS ≤3s` label and copy.
- `deploy/oracle/mediamtx.yml.example` defines two-second segments.
- `deploy/oracle/validate-mediamtx.sh` rejects deployment configs that do not
  use two-second segments and 200 ms parts.
- `deploy/oracle/secrets/mediamtx.yml` contains the matching production value.
- The root and Oracle deployment READMEs describe the new contract.
- Component and browser tests use the new label, limits, and playlist timing.

## Verification

Automated verification covers these requirements:

- hls.js receives the 1.8 s sync target and 3 s buffer and latency limits.
- The profile accepts a two-second target duration with parts no longer than
  250 ms and rejects longer packaging.
- The committed example and the production MediaMTX config pass validation
  with MediaMTX 1.20.1.
- The playback mode remains selectable and preserves the saved `ultra-low`
  preference.

After deployment, verify the live media playlist while OBS publishes. Confirm
that `#EXT-X-TARGETDURATION` is `2`, completed segments are near 2 s, and parts
remain near 200 ms. Then watch `HLS ≤3s`, Balanced, and Smooth long enough to
compare latency, corrective seeks, mode exits, and cold-join time.

## Rollback

Restore `hlsSegmentDuration: 1s` and the previous viewer profile constants,
labels, validation, and documentation. No data migration is required.
