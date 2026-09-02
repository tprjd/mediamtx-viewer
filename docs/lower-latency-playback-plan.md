# Balanced playback latency plan

Status: Balanced candidate A is implemented in the viewer together with the
bounded Smooth profile, native-HLS drift recovery, and HLS live-edge
diagnostics. Production glass-to-glass and impairment acceptance testing is
still required. The later `two-second-ll-hls-plan.md` adds a separate
experimental HLS ≤2s profile, changes managed OBS timing to one-second
keyframes, and makes hls.js preferred for every HLS profile when supported.

## Decision

Add a third viewer mode named **Balanced** between the existing HLS **Smooth**
mode and WebRTC **Low latency** mode.

| Mode | Transport | Target experience | Intended use |
| --- | --- | --- | --- |
| Balanced (recommended default) | LL-HLS | 3–5 seconds glass-to-glass | Normal viewing with less delay but useful Wi-Fi recovery margin |
| Smooth | LL-HLS | 5–8 seconds glass-to-glass, hard recovery before persistent 9+ seconds | Spotty Wi-Fi and viewers who prefer continuity |
| Low latency | WebRTC | Lowest practical delay | Interaction-sensitive viewing on a healthy connection |

The two HLS modes use the same original 1440p60 12 Mbps AV1 bitstream. Changing
their latency policy does not alter resolution, bitrate, scaler, or compression
quality. It changes how far the player stays behind the live edge and how it
returns after a stall.

Do not replace Smooth with a lower-latency configuration. Preserve it as the
recovery-oriented choice and add Balanced as the default. Continue falling back
from failed WebRTC to Smooth, not Balanced, because that transition already
indicates an unreliable viewer path.

## Production evidence captured before planning

The live production playlist was inspected on 2026-09-02 while the stream was
ready. It reported:

```text
#EXT-X-TARGETDURATION:2
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=0.50000
#EXT-X-PART-INF:PART-TARGET=0.20000
#EXTINF:2.00000
```

The master playlist reported one 2560×1440 AV1/Opus rendition at approximately
12.0 Mbps. MediaMTX metrics reported no inbound frames in error at the time of
inspection.

This establishes four useful facts:

1. Low-Latency HLS is operating and parts are already only 200 ms long.
2. The two-second OBS keyframe interval produces two-second completed segments,
   despite MediaMTX's nominal one-second segment setting.
3. MediaMTX advertises a 0.5-second part hold-back, so the server is not
   deliberately requesting a ten-second player delay.
4. The current player is using manifest-driven hls.js latency without a maximum
   live-edge distance or gentle catch-up rate.

In hls.js 1.7.1, the current configuration therefore starts from the manifest's
`PART-HOLD-BACK`. However, `liveMaxLatencyDurationCount` defaults to infinity and
`maxLiveSyncPlaybackRate` defaults to `1`. A viewer can remain many seconds
behind after buffering while decoded frames continue progressing. The existing
frozen-frame watchdog correctly sees that as active playback, and the current
`play` handler only seeks when a new play event occurs. This is the leading
hypothesis for a stream that begins near the edge or suffers a stall and later
appears roughly ten seconds late.

Native HLS is a separate case. The player currently selects the browser's native
HLS implementation before hls.js when `canPlayType()` succeeds. Native Safari
does not consume hls.js latency settings, so its live-edge distance must be
measured and, if necessary, bounded through the media element's seekable range.

## Proposed HLS profiles

Start with explicit seconds rather than segment-count values. Segment-count
values would change behavior if the OBS GOP later changes from two seconds to
one second, while the user-facing target is expressed in seconds.

### Balanced candidate A

```ts
{
  lowLatencyMode: true,
  backBufferLength: 30,
  liveSyncDuration: 3,
  liveMaxLatencyDuration: 6,
  maxLiveSyncPlaybackRate: 1.03,
  liveSyncOnStallIncrease: 0.5,
}
```

Expected behavior:

- aim three seconds behind hls.js's estimated edge;
- allow transient drift without a seek;
- catch up at no more than 3% when sufficiently buffered;
- seek back to the three-second target when latency exceeds six seconds;
- add only 0.5 seconds to the target after a detected stall, capped by hls.js at
  one target duration.

Production measurement found that a browser selecting native HLS held both
Balanced and Smooth near eight seconds because native playback ignored the two
hls.js profiles. Balanced therefore prefers hls.js whenever MSE is supported,
while Smooth retains native HLS as the recovery-oriented browser-managed path.
Balanced falls back to native only when hls.js is unavailable, where the
seekable-edge guard below still applies.

Candidate A is the recommended first implementation. Three seconds represents
15 advertised LL-HLS parts, so it retains substantially more reserve than the
current 0.5-second manifest hold-back even though it is below three complete
two-second segments. The impairment test, not that arithmetic alone, decides
whether it is stable.

### Balanced candidate B

Use this only if candidate A stalls under the accepted Wi-Fi test:

```ts
{
  liveSyncDuration: 4,
  liveMaxLatencyDuration: 7,
  maxLiveSyncPlaybackRate: 1.03,
  liveSyncOnStallIncrease: 0.5,
}
```

Candidate B trades roughly one additional second for another five parts of
reserve. Do not change load policies, part duration, GOP, and latency target in
the same experiment.

### Smooth profile

```ts
{
  lowLatencyMode: true,
  backBufferLength: 30,
  liveSyncDuration: 5,
  liveMaxLatencyDuration: 9,
  maxLiveSyncPlaybackRate: 1.02,
  liveSyncOnStallIncrease: 1,
}
```

Smooth deliberately has more reserve and slower catch-up. Its maximum prevents
the current failure mode where a progressing player can remain about ten or
more seconds behind indefinitely.

Do not restore the former `liveSyncDuration: 1`, `liveMaxLatencyDuration: 3`,
and `maxLiveSyncPlaybackRate: 1.5` combination. It was too close to the edge and
could visibly accelerate playback after disruption.

## Native-HLS policy

For Safari and other native-HLS browsers, first add measurements without forcing
MSE playback:

- `video.seekable.end(video.seekable.length - 1) - video.currentTime`;
- forward buffer length from `video.buffered`;
- current `video.playbackRate`;
- stalls, seeks, and time to the first rendered frame.

If native playback remains above the selected mode's maximum for more than two
consecutive one-second samples while visible, playing, online, and sufficiently
buffered:

1. seek to `seekableEnd - targetSeconds`;
2. reuse the existing recovery reason/event reporting;
3. never seek while the user is paused, scrubbing, the tab is hidden, or the
   stream is offline;
4. do not manually alter playback rate unless Safari testing proves that it
   does not already manage catch-up and preserves audio correctly.

If `seekable` does not provide a reliable live edge on a target browser, expose
Smooth and Low latency there and label Balanced unavailable instead of claiming
a latency target the application cannot enforce.

## Player state and user interface

Replace the current binary protocol state with a playback-mode state:

```ts
type PlaybackMode = 'balanced' | 'smooth' | 'webrtc'
```

- Map the database's existing `hls` preference to `balanced` for a new session.
- Migrate session storage values: old `hls` becomes `balanced`; `webrtc` remains
  `webrtc`.
- Present three compact controls in this order: **Balanced**, **Smooth**, and
  **Low latency**.
- Label Balanced as “Recommended · about 3–5s” only after production measurement
  passes. Before that, use “Testing · lower delay.”
- Keep the 60-second WebRTC circuit breaker.
- A manual mode selection is remembered for the browser session.
- A WebRTC failure automatically selects Smooth and never automatically returns
  to WebRTC.
- Do not automatically oscillate between Balanced and Smooth. Their internal
  latency controllers already handle bounded drift; a viewer can select the
  preferred stability tradeoff.

Changing between the two HLS profiles should recreate the HLS instance while
preserving the current poster/last frame until the replacement renders. It must
not create two long-lived HLS sessions or reset the stream status subscription.

## Diagnostics required before rollout

Extend the existing playback diagnostics with HLS-specific values:

- current live-edge distance (`hls.latency` or native seekable distance);
- selected target and maximum latency;
- forward buffer in seconds;
- current playback rate;
- hls.js versus native-HLS engine;
- last corrective seek and reason;
- playlist target duration, part target, and part hold-back;
- when available, `Date.now() - hls.playingDate` as a server-timeline estimate.

The server-timeline estimate is not a substitute for full glass-to-glass
measurement because the playlist timestamp may begin after capture and ingest.
For acceptance testing, show a millisecond clock in the captured scene and film
the source and viewer together, or compare synchronized screenshots.

Add a copyable support snapshot containing these values, browser/OS, codec,
resolution, frame pacing, loss rate, and selected transport. Do not include
cookies, MediaMTX session query strings, IP addresses, or persistent viewer
identifiers.

## Measurement sequence

### Phase 1 — Instrument the current build

1. Add HLS live-edge, buffer, engine, and playback-rate diagnostics without
   changing latency behavior.
2. Measure a fresh join for five minutes on wired Ethernet and stable Wi-Fi.
3. Introduce a controlled two-second and ten-second viewer outage separately.
4. Record whether the reported ten-second delay exists at startup or accumulates
   after a stall.
5. Repeat in Chromium, Firefox, Safari, iOS Safari, and Android Chrome where
   available.

Exit criterion: distinguish player live-edge drift from capture/OBS/ingest delay
and identify hls.js versus native HLS.

### Phase 2 — Ship Balanced behind a local feature switch

1. Add the three-mode state and candidate A values.
2. Keep Smooth available with its bounded profile.
3. Test fresh joins, normal pause/resume, tab backgrounding, network changes,
   WebRTC fallback, fullscreen, and seeking controls.
4. Confirm the player does not seek repeatedly around the maximum boundary.
5. Confirm a 1.03 catch-up rate is temporary and returns to `1` at target.

Exit criterion: Balanced reaches its target without protocol oscillation,
reconnect storms, audible artifacts, or repeated corrective seeks.

### Phase 3 — Impairment and load validation

Run each HLS profile through:

- healthy wired and Wi-Fi playback for 30 minutes;
- 1% random loss plus 30 ms jitter;
- 3% random loss and a two-second burst outage;
- a ten-second outage;
- Wi-Fi/LAN network change;
- two simultaneous publishers and ten total viewers;
- native 1440p and 4K-to-1440p OBS inputs;
- AV1 on each actually supported browser/device.

Do not use browser DevTools throttling as the only impairment source. Apply
viewer-path impairment in a controlled network namespace/router and keep it
away from production SSH.

### Phase 4 — Select the default

- Choose candidate A if its stability criteria pass.
- Move to candidate B only if A's lower reserve causes measured stalls.
- Make Balanced the default only after its glass-to-glass target is verified.
- Retain Smooth and Low latency as explicit choices.
- Roll back only the new latency profile if it regresses; retain diagnostics,
  warm HLS, HTTP/3, TCP ICE, and recovery logic.

## Acceptance criteria

### Balanced

- healthy glass-to-glass latency: median 3–4 seconds, p95 no more than 5 seconds;
- reported live-edge distance returns below six seconds within ten seconds after
  a recoverable outage;
- no persistent delay above six seconds while playing normally;
- no more stalls than the current Smooth build in the 1% loss test;
- no audible pitch artifact or visibly accelerated motion;
- at most one corrective seek per impairment event.

### Smooth

- healthy glass-to-glass latency: 5–8 seconds;
- no persistent delay above nine seconds;
- better continuity than Balanced in the 3%/burst-loss case;
- ten-second outage recovers without a page reload.

### Low latency

- existing WebRTC startup, repair, and fallback criteria remain unchanged;
- a failed WebRTC session falls back to Smooth;
- no automatic return to WebRTC.

All modes must preserve the source 2560×1440/60 presentation and nominal 12 Mbps
top rendition when the viewer can sustain and decode it.

## OBS and MediaMTX decision gates

Make no initial OBS or MediaMTX timing change. The production server already
uses LL-HLS, 200 ms parts, warm remuxing, HTTP/3, and error-free ingress during
the captured sample.

Only A/B-test a one-second OBS keyframe interval if instrumentation proves one
of these:

- first frame or corrective seek is consistently waiting for the next IDR;
- two-second completed segments prevent candidate A from staying within 3–5
  seconds even though part delivery and viewer bandwidth are healthy;
- browser compatibility testing shows parts cannot be used effectively for the
  deployed codec.

The one-second GOP experiment can improve join/seek granularity but may reduce
compression efficiency at the same 12 Mbps, especially in foliage-heavy games.
Change it only for the test profile, compare the same recorded scene, and keep
two seconds unless the latency/recovery gain is material.

Do not reduce `hlsPartDuration` below 200 ms initially. More frequent parts add
request, encryption, and scheduling overhead and do not solve a player that is
allowed to remain behind. Do not change `hlsSegmentCount`; MediaMTX documents
that it controls retained seek history rather than live latency.

## Expected implementation files

- `components/live-player.tsx`: three-mode state, session migration, labels,
  default, and WebRTC-to-Smooth fallback.
- `components/hls-player.tsx`: typed HLS latency profiles, continuous drift
  bounds, native-HLS handling, and mode-switch recreation.
- `components/playback-stats.tsx`: live-edge, buffer, engine, rate, and recovery
  diagnostics.
- focused component tests for mode migration, profile configuration, catch-up,
  maximum-latency seek, hidden/paused behavior, native HLS, and fallback.
- Playwright coverage for the three controls at desktop and 320 px width.
- `docs/video-quality-resilience-plan.md`: record the accepted measured profile
  after rollout.
- OBS setup files and tests only if the one-second GOP evidence gate passes.

## References

Reviewed 2026-09-02:

- [MediaMTX HLS configuration reference](https://mediamtx.org/docs/references/configuration-file)
- [MediaMTX HLS playback](https://mediamtx.org/docs/read/hls)
- [hls.js API: live synchronization and latency controls](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [hls.js latency controller](https://github.com/video-dev/hls.js/blob/master/src/controller/latency-controller.ts)
- [Existing video quality and resilience plan](./video-quality-resilience-plan.md)
