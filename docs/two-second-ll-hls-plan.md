# Two-second LL-HLS playback plan

Status: implemented in the viewer, MediaMTX example configuration, and managed
OBS setup 1.3.0. Automated verification is included. Production glass-to-glass,
quality, load, and impairment acceptance testing is still required, so the mode
remains experimental and does not replace Balanced, Smooth, or WebRTC.

Superseded on 2026-09-02 by
`docs/two-keyframe-low-latency-hls-plan.md`, which replaces the two-second
budget with a more resilient three-second budget and two-second segments.

## Objective and definition of success

Add an **HLS ≤2s** mode that keeps both of these viewer-side measurements at or
below two seconds during healthy, active playback:

- **live-edge latency:** `hls.latency`, the hls.js estimate from the HLS live edge
  to `video.currentTime`;
- **forward buffer:** the end of the buffered range containing
  `video.currentTime`, minus `video.currentTime`.

The two-second latency limit is not automatically a two-second glass-to-glass
limit. `hls.latency` does not include OBS capture, encode/reorder, WHIP ingest,
MediaMTX packaging, display refresh, or clock error. Glass-to-glass latency must
be measured separately with a clock in the captured scene. The initial rollout
therefore has two acceptance classes:

1. the required player SLO is at most two seconds of HLS live-edge latency and
   forward buffer during healthy playback;
2. an optional end-to-end SLO of at most two seconds is accepted only if the
   source-to-screen test also passes.

The mode prioritizes latency over continuity. It must stall or leave the mode
rather than silently grow beyond the two-second budget. Balanced and Smooth
remain available for viewers whose network cannot sustain the source bitrate
with this small reserve.

## Baseline before implementation and blockers

The repository already has the required LL-HLS foundation:

- MediaMTX 1.20.1 is pinned and `hlsVariant: lowLatency` is enabled;
- HLS remuxing is kept warm with `hlsAlwaysRemux: true`;
- production playlists have advertised 200 ms parts and a 500 ms part
  hold-back;
- Balanced prefers hls.js where Media Source Extensions are supported;
- playback diagnostics already expose engine, live latency, forward buffer,
  playback rate, segment duration, part duration, and part hold-back.

Three current settings prevent a credible two-second contract:

1. Balanced targets three seconds and corrects only after six seconds.
2. hls.js keeps its default 30-second forward-buffer loading target because
   only `backBufferLength` is configured. `backBufferLength` limits already
   played media, not the forward buffer.
3. Managed OBS profiles use a two-second keyframe interval. MediaMTX has a
   nominal one-second segment duration, but it extends segments to include an
   IDR frame, so production segments are currently two seconds long.

The source is a single 1440p60 AV1 rendition at about 12 Mbps. A two-second
forward buffer contains roughly 3 MB of video before container and audio
overhead. There is no lower rendition to absorb sustained viewer bandwidth
shortfalls.

## Selected first candidate

Add a distinct profile rather than changing Balanced:

```ts
type HlsLatencyProfile = 'ultra-low' | 'balanced' | 'smooth'

const HLS_LATENCY_PROFILES = {
  'ultra-low': {
    label: 'HLS ≤2s',
    lowLatencyMode: true,
    liveSyncMode: 'edge',
    liveSyncDuration: 1.2,
    liveMaxLatencyDuration: 2,
    liveSyncOnStallIncrease: 0,
    maxLiveSyncPlaybackRate: 1.05,
    maxBufferLength: 1.8,
    maxMaxBufferLength: 1.8,
    backBufferLength: 0,
  },
  // Existing Balanced and Smooth profiles remain unchanged.
}
```

Rationale:

- a 1.2-second target leaves 0.8 seconds for drift before correction and holds
  approximately six 200 ms parts;
- explicit low-latency and edge-sync modes prevent library defaults from
  changing the contract during a future dependency upgrade;
- the maximum must be strictly greater than the target because hls.js rejects
  equal values;
- zero stall growth prevents hls.js from increasing its target beyond the
  selected budget after repeated stalls;
- 1.05x catch-up is enough to remove small drift without the visibly fast
  playback caused by aggressive rates;
- 1.8-second loading limits reserve one 200 ms part of headroom for an in-flight
  append. `maxBufferLength` is a loading goal, while `maxMaxBufferLength` is the
  actual time-based cap used to prevent the default byte budget from expanding
  the buffer at lower bitrates;
- `backBufferLength: 0` requests minimum retained history. Browser and hls.js
  segment-boundary rules can still keep a small amount of played media, so the
  two-second contract applies to forward buffer, not total MSE memory.

Do not add a small `maxBufferSize` as a substitute for
`maxMaxBufferLength`. A byte limit produces different time buffers at different
bitrates. Keep the limit time-based.

Because loading and removal occur on media-part/sample boundaries, no hls.js
setting can prove a mathematical never-over-2.000-second bound. Start with 1.8
seconds, record the actual maximum, and lower both loading limits by one observed
overshoot quantum if any healthy sample exceeds 2.0 seconds. Do not trim playable
forward media with `SourceBuffer.remove()` during normal playback; repeated
front-buffer removal near the playhead is likely to create gaps and stalls.

## MediaMTX and publisher timing

Make the existing MediaMTX defaults explicit in
`deploy/oracle/mediamtx.yml.example` so the latency contract does not change
silently after an image upgrade:

```yaml
hlsVariant: lowLatency
hlsAlwaysRemux: true
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
```

Keep `hlsSegmentCount` unchanged. It controls the available playlist window and
does not add playback latency.

Change the managed OBS profile from `keyint_sec = 2` to `keyint_sec = 1` and
update its integration test and documentation. A one-second GOP allows
MediaMTX to produce one-second completed segments instead of extending them to
the next two-second IDR. This increases keyframe frequency and can slightly
reduce compression efficiency at the same bitrate, so compare fine detail and
encoder load against the existing profile before making HLS ≤2s generally
available.

Keep bitrate, resolution, frame rate, codec, preset, lookahead, and B-frames
unchanged in the first experiment. If viewer live-edge latency passes but
glass-to-glass latency does not, separately A/B-test zero B-frames. Do not mix a
B-frame change with GOP and player tuning because the result would not identify
which change affected latency or quality.

After deploying the timing change, verify the live media playlist contains:

```text
#EXT-X-TARGETDURATION:1
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=0.50000
#EXT-X-PART-INF:PART-TARGET=0.20000
```

Also verify completed `#EXTINF` values are approximately one second. Do not
enable the mode if completed segments remain two seconds; fix the publisher GOP
or confirm MediaMTX received regular IDR frames first.

## Player behavior

Implement the profile in `components/hls-player.tsx` with these rules:

1. Use hls.js whenever `Hls.isSupported()` is true, even when native HLS is also
   available.
2. Mark HLS ≤2s unavailable when hls.js is unsupported. Native HLS does not
   honor hls.js buffer settings, so native fallback cannot honestly advertise
   this contract. Balanced or Smooth may continue using native HLS.
3. Sample `hls.latency` and forward buffer every 250 ms while the tab is
   visible, the stream is live, and playback is not intentionally paused or
   seeking. Keep these samples in refs and publish diagnostics to React state at
   the existing one-second rate so the tighter watchdog does not cause four
   component renders per second.
4. If latency exceeds two seconds, seek once to `hls.liveSyncPosition`. Rate
   limit corrective seeks to one per second. hls.js should normally perform the
   same correction from `liveMaxLatencyDuration`; the explicit guard makes the
   application SLO observable and covers delayed controller updates.
5. If latency remains above two seconds for one second after correction,
   recreate the HLS instance through the existing bounded recovery path.
6. Never seek merely because forward buffer exceeds two seconds. Loading limits
   should stop growth; record the breach for tuning. A seek moves the playhead
   but does not safely enforce a forward-buffer cap.
7. Reset the breach window after stable playback. Keep current authorization,
   codec-error, offline, hidden-tab, user-pause, and fatal-error behavior.
8. Never increase `liveSyncDuration`, `liveMaxLatencyDuration`, or the buffer
   limits in response to a stall while this mode remains selected.

Treat repeated stalls as proof that the connection cannot sustain the mode. Two
stalls or recreations within 30 seconds should switch to Balanced, persist that
new session choice, and show a short notice that the two-second HLS limit could
not be maintained. This changes mode explicitly instead of allowing hidden
latency growth.

## User interface and state

Extend playback state to:

```ts
type PlaybackMode = 'ultra-low' | 'balanced' | 'smooth' | 'webrtc'
```

Present controls in this order:

1. **HLS ≤2s** — experimental, least recovery margin;
2. **Balanced** — existing recommended HLS mode;
3. **Smooth** — existing recovery-oriented HLS mode;
4. **WebRTC** — lowest practical transport latency.

Keep Balanced as the default until the full acceptance matrix passes. Store
`ultra-low` in the existing session-storage key only after an explicit viewer
selection. If hls.js is unsupported, disable the control and explain that the
browser only exposes native HLS. Do not rename WebRTC to avoid confusing its
latency and recovery tradeoff with the new HLS mode.

Add these fields to the copyable support snapshot:

- configured and observed maximum forward buffer;
- latency breach count;
- forward-buffer breach count;
- last breach timestamp and measured value;
- corrective-seek count;
- active GOP/segment/part timing where observable;
- reason for leaving HLS ≤2s mode.

Do not include playlist authorization query strings, cookies, IP addresses, or
persistent viewer identifiers.

## Implementation sequence

### Phase 1: make timing measurable

1. Add 250 ms samples and breach counters without changing playback behavior.
2. Record fresh join, five-minute steady state, pause/resume, hidden-tab return,
   and a two-second network interruption on Chromium and Firefox.
3. Capture both hls.js latency and forward-buffer peaks, plus glass-to-glass
   latency from a visible source clock.

Exit criterion: baseline peaks and upstream latency are known, and diagnostics
distinguish viewer live-edge delay from total source-to-screen delay.

### Phase 2: shorten packaging cadence

1. Set the MediaMTX segment and part durations explicitly.
2. Change managed OBS GOP to one second, update setup versioning and docs, and
   repair one test publisher profile;
3. Confirm one-second segments, 200 ms parts, regular IDR cadence, clean OBS
   encode/render stats, and no MediaMTX fragment errors;
4. Compare still-detail and high-motion captures against the two-second-GOP
   baseline at the same bitrate.

Exit criterion: playlist contract matches the expected tags and image quality
loss, if any, is accepted.

### Phase 3: add HLS ≤2s behind an experimental control

1. Add the new profile and hls.js-only capability check.
2. Add immediate latency correction, breach reporting, and explicit fallback to
   Balanced after repeated failure.
3. Keep other modes and WebRTC fallback behavior unchanged.
4. Tune only `liveSyncDuration`, then only the two buffer limits. Do not change
   load policies or network retry timing in the same test.

Exit criterion: no healthy sample exceeds the two-second viewer SLO, no seek
loop occurs, and the mode leaves itself rather than silently exceeding its
budget on an unsuitable connection.

### Phase 4: production acceptance

Run each case for HLS ≤2s, then repeat key cases in Balanced to detect shared
regressions:

- 30 minutes on wired Ethernet;
- 30 minutes on stable Wi-Fi;
- 1% random loss plus 30 ms jitter;
- 3% random loss;
- a two-second outage and a ten-second outage;
- pause/resume and tab background/foreground;
- Wi-Fi-to-LAN network change;
- two simultaneous publishers and ten total viewers;
- Chromium and Firefox on desktop plus Android Chrome where hls.js/MSE supports
  the published codec.

Safari/iOS native HLS is a capability test only; it must show the mode as
unavailable rather than be counted as a pass.

## Tests and verification

Add or update automated coverage for:

- exact ultra-low hls.js configuration, including both buffer-length fields;
- unchanged Balanced and Smooth configuration;
- hls.js selection when both hls.js and native HLS are available;
- disabled ultra-low mode when only native HLS is available;
- latency correction above two seconds and no correction at or below it;
- no correction while paused, hidden, offline, or seeking;
- corrective-seek cooldown and recreation after a persistent breach;
- repeated-stall fallback to Balanced with session storage updated;
- diagnostic breach fields and safe support-snapshot serialization;
- OBS one-second keyframe output and MediaMTX explicit timing validation.

Run:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
sh deploy/oracle/validate-mediamtx.sh deploy/oracle/mediamtx.yml.example
```

Production acceptance requires all of these conditions:

- observed hls.js live latency is no more than 2.0 seconds during healthy
  playback;
- observed forward buffer is no more than 2.0 seconds during healthy playback;
- steady-state stall rate is zero in the 30-minute wired and stable-Wi-Fi runs;
- no repeated corrective-seek loop or accelerated-audio artifact occurs;
- startup reaches the first rendered frame within three seconds;
- after a two-second outage, playback returns within five seconds or explicitly
  switches to Balanced;
- OBS has no render or encoder overload and MediaMTX has no new fragment errors;
- the one-second GOP quality tradeoff is accepted;
- unsupported browsers never display a false ≤2s claim.

Report glass-to-glass results separately. Do not claim a two-second end-to-end
SLO unless its worst healthy measurement is also at most 2.0 seconds.

## Rollback

Rollback is independent and reversible:

1. hide the experimental control and map stored `ultra-low` values to Balanced;
2. remove its profile without changing Balanced, Smooth, or WebRTC;
3. restore managed OBS `keyint_sec = 2` if the one-second GOP causes unacceptable
   quality or encoder cost;
4. leave explicit MediaMTX `1s` segment and `200ms` part settings in place unless
   measurements show a server regression, because the two-second GOP still
   determines actual completed segment duration.

## Primary references

- [hls.js 1.7.1 API and configuration](https://github.com/video-dev/hls.js/blob/v1.7.1/docs/API.md)
- [MediaMTX 1.20.1 reference configuration](https://github.com/bluenviron/mediamtx/blob/v1.20.1/mediamtx.yml)
