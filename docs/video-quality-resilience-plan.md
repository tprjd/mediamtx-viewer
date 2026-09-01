# Video quality and playback resilience plan

Status: planning is complete. Setup 1.2.0's OBS quality baseline and the
browser's rolling frame-pacing diagnostics are implemented. The delivery-path,
buffering-default, recovery-controller, transport, and observability phases
below remain implementation work; this document is not claiming those rollout
phases are already deployed.

## Objective

Deliver the highest source-faithful video quality the current OBS profiles can
produce while making playback recover automatically from packet loss, network
changes, browser stalls, publisher interruptions, and service restarts.

Treat setup version 1.2.0's OBS profiles as the quality-preserving baseline, not
an absolute constraint. The selected 1440p60 NVIDIA AV1 baseline is 12 Mbps CBR,
P5 High Quality, quarter-resolution multipass, adaptive quantization on,
lookahead off, two B-frames, and Area scene-item scaling. Change another OBS
setting only when measurements show that it is the blocking point in the
publisher-to-MediaMTX flow or the only practical way to make the published
stream usable. Each such change must be isolated, A/B-tested, documented with
its quality tradeoff, and reversible. Do not use an OBS change to hide a server
socket, proxy, capacity, or player-recovery defect.

The desired viewer experience is:

- preserve the exact encoded source whenever the device can decode it;
- default to LL-HLS smooth mode at approximately 3-5 seconds end-to-end
  latency, preserving the same encoded source quality;
- offer WebRTC as an optional low-latency mode and fall back to LL-HLS when it
  cannot stay healthy;
- recover brief WebRTC failures before showing a disruptive error;
- move to an already-warm LL-HLS path when WebRTC cannot stay healthy;
- keep retrying safely for as long as MediaMTX says the stream is live;
- rejoin automatically after the publisher or media service returns;
- never require a page refresh for an ordinary transient failure;
- explain codec or device limitations instead of presenting them as network
  failures.

## Constraints and unavoidable limits

MediaMTX currently remuxes/routes the single OBS output; it does not transcode
it. WebRTC and HLS therefore carry the same source quality. This is desirable on
a healthy connection, since there is no generational loss, but has three hard
consequences:

1. Packets lost between OBS and MediaMTX can damage the stream for every viewer.
   MediaMTX cannot recreate encoded data that never arrived.
2. A viewer whose sustained bandwidth is below the OBS bitrate cannot be made
   smooth indefinitely with buffering or retry tuning alone. The remedies are a
   lower source bitrate or additional lower renditions.
3. A browser or device that cannot decode the published codec will not become
   compatible merely by changing from WebRTC to HLS. The remedy is a compatible
   source/rendition or downstream transcoding.

Adaptive bitrate playback would address the second limit, and sometimes the
third, but requires additional renditions. Server-side renditions would require
transcoding, and the current 1-OCPU ARM VM is not a credible target for real-time
1440p60 software transcoding. OBS 32.1+ can instead encode WHIP simulcast layers,
but MediaMTX 1.20.1 does not expose those layers to browser WebRTC as a
selectable adaptive stream. Treat source simulcast plus layer extraction, a
separate GPU-backed transcoder, or a managed media service as future architecture
options rather than enabling extra OBS layers without a working consumption
path.

## Evidence gate for OBS changes

The generated profiles use sensible real-time transport values: 60 fps, CBR, a
two-second keyframe interval, Opus, hardware encoding, one WHIP layer, and
automatic reconnect. NVIDIA AV1 uses two B-frames for compression efficiency;
the other generated vendor/codec combinations retain zero. Preserve these
unless the following evidence identifies a source-side blocker:

| Evidence | Allowed OBS experiment | Tradeoff and guardrail |
| --- | --- | --- |
| Publish-side loss rises for all viewers and the encoded bitrate approaches/exceeds sustained available upload after server socket drops are ruled out | Reduce bitrate in one controlled step; if encoder/load or link margin still fails, test the existing lower-resolution profile | Lower nominal bitrate/resolution, but potentially higher perceived quality than corrupted or frequently frozen frames; retain the highest setting that passes the long impairment run |
| OBS reports encoder overload, skipped frames, or render lag before packets reach MediaMTX | Test a less expensive encoder preset, lower resolution, or lower frame rate in that order based on the OBS log bottleneck | Can reduce compression efficiency, detail, or motion smoothness; do not blame the network until OBS output health is clean |
| Warm LL-HLS still cannot meet startup/recovery targets because usable fragments wait on the two-second GOP | A/B-test a one-second keyframe interval | Faster join/recovery at some compression-efficiency cost; keep two seconds if the measured recovery gain is not material |
| Intended browsers cannot decode the published AV1/HEVC stream | Publish the existing H.264 profile, or design a simultaneous compatible rendition | H.264 needs more bitrate for similar quality; protocol fallback alone cannot solve a decoder mismatch |
| OBS exhausts its configured reconnect attempts during a realistic publisher/WAN or MediaMTX outage | Increase the maximum reconnect window and validate its exponential retry timing | Improves unattended recovery without changing image quality; avoid a tight reconnect storm against an unhealthy backend |
| A representative viewer population cannot sustain the source bitrate and a single rendition is proven to be the blocker | Prototype OBS simulcast only together with an end-to-end MediaMTX layer-extraction/selection design | Extra upload and GPU encoder load; do not enable multiple layers until WebRTC and HLS can deliberately select them and the top layer remains unchanged |

Treat NVIDIA AV1's two B-frames as accepted only after the Chrome, Firefox, HLS,
and WHEP playback matrix passes. Their reorder delay is small relative to the
3-5 second smooth mode, but browser behavior is more important than their modest
compression gain. Roll NVIDIA AV1 back to zero immediately if the low-latency
path shows decode stalls or recovery regressions. Keep H.264 at zero B-frames
for broad WebRTC compatibility. Keep the existing top-quality layer unchanged
in any simulcast experiment, so capable viewers do not lose quality. Any
accepted OBS change must be applied consistently by the managed setup script,
existing profiles, setup documentation, and validation tests; a manual
one-machine tweak is not a completed fix.

## Workload and infrastructure assumptions

This plan is sized for the stated normal source and audience:

- OBS publishes 2560x1440 AV1 at 60 fps and 12 Mbps from a native 1440p game or
  an Area-filtered 4K capture;
- publisher access is nominally 100 Mbps or 1 Gbps;
- viewer-side Wi-Fi can be intermittent;
- approximately 3-5 seconds of latency is acceptable;
- one or two streams can be live simultaneously;
- the expected maximum is about ten simultaneous viewers total across those
  streams;
- added infrastructure is allowed only when it remains within verified Oracle
  Always Free allowances.

At 12 Mbps, a 100 Mbps publisher link has ample headline throughput, so bitrate
alone is not the leading explanation for an alt-tab/heavy-game freeze. Jitter,
Wi-Fi loss, OBS render/encoder starvation, or the captured application ceasing
to render remain possible and must be measured separately.

Ten total viewers each watching one 12 Mbps stream are approximately 120 Mbps
of media egress before RTP/DTLS or HTTP overhead, regardless of whether they are
split across one or two live publishers. Two publishers add at most roughly
24 Mbps of media ingress and require two warm HLS muxers. Viewer egress is about
54 GB per hour before overhead. OCI documents 1 Gbps of network bandwidth per
A1 OCPU, so the current one-OCPU shape has enough nominal bandwidth, but
encryption, packet processing, burst queues, two live paths, and concurrent
application work still require a ten-viewer/two-publisher load test. OCI
currently includes 10 TB/month outbound data in Always Free; ten continuously
connected viewers at this source rate would consume that allowance in roughly
185 hours before overhead, or less after overhead. Keep the existing usage
dashboard as the guardrail rather than assuming the allowance cannot be
exceeded.

OCI also documents 3,000 A1 OCPU-hours and 18,000 GB-hours of A1 memory per
month at no charge. If those allowances are not used by other instances, the
current 1-OCPU/6-GB VM can be resized up to the equivalent of approximately
4 OCPUs/24 GB continuously without adding a different compute class. Prefer
that measured, in-place headroom before introducing another service. Oracle
does not list GPU compute as Always Free, so GPU transcoding is excluded unless
the user later changes the cost constraint.

### What the 3-5 second target does and does not improve

The latency target does **not** increase encoded image quality. On a healthy
connection, WebRTC and HLS deliver the same 2560x1440 AV1 source frames, so
resolution, bitrate, compression detail, and color are unchanged. Adding delay
cannot create detail that OBS did not encode.

The target improves continuity and therefore perceived quality on an imperfect
viewer connection:

- three to five seconds at 12 Mbps represents roughly 4.5-7.5 MB of media time
  that can absorb Wi-Fi jitter and short throughput dips;
- HTTP-based HLS can retransmit missing data instead of immediately accepting
  late/lost UDP media as a real-time loss;
- the player has room to recover parts and maintain a steady live edge instead
  of repeatedly freezing or showing damaged frames.

It does not fix publisher-to-MediaMTX loss, OBS render/encoder starvation,
static capture after alt-tab, unsupported AV1 decoding, or a viewer connection
whose sustained throughput remains below 12 Mbps. Those require the separate
source, codec, or rendition actions in this plan. Treat 3-5 seconds as the
accepted maximum operating envelope to tune within, not a magic value: choose
the smallest measured buffer/latency that passes the Wi-Fi impairment tests.

This is playback reserve, not OBS's fixed **Stream Delay** feature. Smooth mode
runs a few seconds behind the live edge so the HLS player can keep media ahead,
retransmit missing HTTP data, and ride through short Wi-Fi dips. Do not add a
three- or five-second delay inside OBS: that would consume publisher memory and
add delay without giving the viewer player extra recovery information.

### Selected OBS quality/load baseline

Setup version 1.2.0 generates this NVIDIA AV1 baseline for one 1440p60 stream
on an RTX 5060 Ti or faster GPU:

| Setting | Selected value | Reason |
| --- | --- | --- |
| Canvas/output | 2560x1440 at 60 fps | Required source presentation; no output rescale for the 1440p profile |
| Rate control/bitrate | CBR at 12,000 Kbps | Predictable WHIP and single-rendition viewer bandwidth |
| GOP | Two-second keyframes | Existing join/recovery compromise |
| NVENC | AV1 Main, P5, High Quality | Good quality without the load of P6/P7 or UHQ |
| Multipass | Quarter-resolution two-pass | Better allocation than single-pass with less load than full-resolution multipass |
| Adaptive quantization | On | Preserves perceptually important detail |
| Lookahead | Off | Avoids extra GPU work and buffering while a game is rendering |
| B-frames | Two for NVIDIA AV1 | OBS-style compression-efficiency baseline; zero is the compatibility rollback |
| Color | NV12, Rec. 709, limited range | Stable SDR/browser path; HDR/Main10 is a separate design |
| Source scaling | Area into the 1440p canvas | Native 1440p is unchanged; 4K is prefiltered to reduce foliage shimmer and encoder entropy |

The RTX 5060 Ti has one ninth-generation NVENC engine, which is sufficient for
one 1440p60 stream at this preset. The greater operational risk is a game
saturating the GPU render/3D queues that OBS needs for capture, composition, and
4K-to-1440p scaling. During the heavy-game test, cap game frame rate or reduce a
GPU-heavy game option until OBS reports no frames missed from rendering lag.
Disable film grain and avoid stacked or excessive sharpening because both spend
the fixed bitrate on noise rather than stable detail.

Existing managed profiles and scene collections are preserved by normal setup
reruns. Run `-RepairManagedConfig` to rebuild existing profiles with the new
NVIDIA AV1 encoder settings. Run `-ResetManagedConfig` to also recreate the
managed scene collection with Area scaling; both flows back up managed files
and require confirmation. A fresh install receives both defaults directly.

The two viewer modes deliberately share this one source bitstream:

- **Smooth (default):** LL-HLS, tuned to a measured 3-5 seconds glass-to-glass
  latency with a useful playback reserve.
- **Low latency:** WebRTC/WHEP, kept as an explicit viewer choice for faster
  interaction, with bounded repair and automatic fallback to warm LL-HLS.

Do not automatically return a viewer from healthy HLS to WebRTC. Offer
**Try low latency again** after the circuit-breaker interval so a viewer with a
spotty network can choose the latency/stability tradeoff without protocol
flapping.

## Current path and useful existing work

```text
OBS -- WHIP/WebRTC --> Caddy -- HTTP signaling --> MediaMTX
                              -- UDP 8189 media --> MediaMTX

Browser -- HTTPS/WHEP signaling --> Caddy --> MediaMTX
        -- UDP 8189 WebRTC media -----------> MediaMTX
        -- HTTPS LL-HLS parts ----> Caddy --> MediaMTX
```

The repository already has several good foundations:

- WebRTC is the default, preserving the source at low latency.
- HLS.js is configured for LL-HLS and is available as a compatibility fallback.
- The WebRTC player detects five samples without decoded/presented frame
  progress, rebuilds once, then falls back to HLS on another stall.
- MediaMTX's bundled WHEP reader independently retries failed/closed peer
  connections after two seconds.
- Browser diagnostics display received bitrate, resolution, frame rate, dropped
  frames, cumulative packet loss, RTT, rolling source/presentation frame times,
  a ten-second pacing graph, late-frame count, decode/processing time, WebRTC
  jitter-buffer delay, and receiver-reported freezes.
- The host and MediaMTX already use a 2.5 MB UDP receive buffer, allow IPv4
  path-MTU discovery messages, and keep RTSP on TCP.
- Stream state reaches the watch page through SSE, so an offline stream can be
  detected and later restarted without reloading the page.

Relevant implementation points are
[`components/webrtc-player.tsx`](../components/webrtc-player.tsx),
[`components/hls-player.tsx`](../components/hls-player.tsx),
[`components/live-player.tsx`](../components/live-player.tsx),
[`components/playback-stats.tsx`](../components/playback-stats.tsx),
[`deploy/oracle/mediamtx.yml.example`](../deploy/oracle/mediamtx.yml.example),
[`deploy/oracle/Caddyfile`](../deploy/oracle/Caddyfile), and
[`deploy/oracle/docker-compose.yml`](../deploy/oracle/docker-compose.yml).

## Findings and improvement opportunities

### 1. The smooth path should be the default

The current database provisions channels with WebRTC as preferred playback.
That optimizes latency, but the acceptable latency is now known to be 3-5
seconds and the reported viewer failure is intermittent Wi-Fi. LL-HLS carries
the same encoded AV1 frames while adding reliable HTTP transport and a useful
buffer, so it is the better default for this audience.

- Change existing and newly provisioned channels to HLS smooth mode.
- Keep the full 1440p60 12 Mbps source; this is a transport/buffer choice, not a
  quality downgrade.
- Present **Low latency** as an explicit WebRTC option for viewers who prefer it.
- Persist that choice for the browser session and always retain automatic HLS
  fallback from WebRTC.
- Target measured glass-to-glass latency within 3-5 seconds rather than forcing
  a one-second live edge that repeatedly stalls on weak Wi-Fi.

### 2. The emergency HLS path is cold

`hlsAlwaysRemux` is not set, so MediaMTX uses its default of `false`. The first
HLS request after WebRTC fails must start the muxer and wait for usable media.
With the fixed two-second OBS keyframe interval, this can make the fallback look
like another failure.

Set `hlsAlwaysRemux: true` after measuring its CPU and memory cost with two
simultaneous live publishers. This does not
transcode and does not change image quality. It only keeps LL-HLS ready while a
path is live.

### 3. HLS is tuned closer to the edge than its own guidance recommends

The player forces `liveSyncDuration: 1` and `liveMaxLatencyDuration: 3` while
MediaMTX's nominal segment duration is one second and the actual segment
boundary is also constrained by the two-second source keyframe interval.
HLS.js warns that a live sync duration below roughly three segment durations,
or a maximum too close to the target, is prone to stalls. A
`maxLiveSyncPlaybackRate` of `1.5` can also create a visibly accelerated catch-up
instead of a smooth recovery.

Start by removing the one- and three-second overrides so HLS.js can respect the
LL-HLS playlist's part hold-back. Then tune from impairment-test evidence. If an
explicit target is still needed, derive it from observed playlist target/part
durations, keep the maximum comfortably above it, and use at most 1.05-1.10
catch-up playback. Do not reinstate a fixed one-second target without evidence
that it survives the impairment matrix. Quality remains bit-for-bit unchanged;
the tradeoff is a little more fallback latency for far fewer stalls.

### 4. HLS recovery has lifetime retry limits and no frozen-frame watchdog

The player calls `startLoad()` for only three fatal network errors and
`recoverMediaError()` only once for the component's entire lifetime. These
counters do not reset after a long healthy interval. Fatal retries have no
application-level delay, a `waiting`/`stalled` event changes only the label, and
native HLS has no equivalent recovery loop. A live stream can therefore remain
stuck until the user presses **Try again**.

Replace this with an explicit recovery controller shared by HLS.js and native
HLS:

- distinguish manifest/playlist, fragment/part, media/decoder, authorization,
  offline, and unsupported-codec failures;
- monitor frame or `currentTime` progress, buffer length, and time since the
  last progress event;
- on a short stall, allow HLS.js's internal gap and load recovery to work;
- next seek to the current live sync position when safe;
- recreate the HLS instance or reload the native source if progress still does
  not resume;
- retry with bounded exponential backoff plus jitter while the stream remains
  live, resetting the failure budget after a stable playback window;
- pause aggressive recovery while the user has intentionally paused, the tab is
  hidden, the browser is offline, or the channel is offline;
- resume immediately on `online`, visibility return, or a new live transition;
- preserve distinct terminal states for expired authorization and unsupported
  decoding.

Use HLS.js's current load-policy API rather than deprecated
`fragLoadingMaxRetry`-style settings. Do not layer immediate application retries
on top of retries already being performed by HLS.js.

### 5. WebRTC currently has two overlapping recovery owners

MediaMTX's dynamically loaded `reader.js` recreates a failed peer connection
every two seconds. The React component separately has initial/failure fallback
timers and a decoded-frame watchdog that closes and rebuilds the reader. This
nested behavior makes recovery timing difficult to reason about and test.
Additionally, the application cannot directly observe the reader's peer
connection state except through a track event.

Bring the version-matched MediaMTX WHEP reader into the application as a pinned,
license-preserving module, or wrap an equivalently tested WHEP client. Give the
application one recovery controller and expose at least:

- peer connection and ICE connection state;
- the selected ICE candidate-pair transport (`udp`, `tcp`, or relay);
- first track and first rendered-frame events;
- a typed error category and HTTP status;
- close/reconnect operations with abortable signaling requests.

Retain MediaMTX's offer editing for stereo Opus and non-advertised codecs when
vendoring it. Pin the client to the deployed MediaMTX version and add an upgrade
check so server/client protocol behavior cannot drift silently.

For a frozen or failed session, prefer make-before-break recovery: open a
replacement WHEP session, wait for its first rendered frame, atomically swap the
video's `MediaStream`, and then close the old session. Bound overlap to a few
seconds so viewer counts and outbound bandwidth settle quickly.

Trigger recovery on actual lack of media progress or terminal connection state,
not on packet loss alone. A browser's jitter buffer and RTP feedback can recover
loss without interruption; reconnecting a session that is still playing would
make the experience worse.

### 6. Protocol fallback is permanent and lacks hysteresis

`LivePlayer` changes from WebRTC to HLS once and cannot return until remount or
page reload. This avoids flapping, but it also leaves a viewer on the higher
latency path after a brief network change. It has no memory of a repeatedly bad
WebRTC path either.

Move protocol choice into a small state machine. HLS is the default path; the
WebRTC branch is entered when the viewer chooses low latency:

```text
HLS starting -> HLS playing -> HLS recovering
     ^               |
     |               +-- viewer chooses low latency
     |                                  |
     +-- WebRTC failure budget -- WebRTC starting -> playing -> recovering
```

Rules:

- keep showing the last usable frame with a subtle reconnect indicator for a
  short interruption; avoid immediately covering it with a full-screen overlay;
- try a bounded number of fast WebRTC repairs, then enter an HLS circuit-breaker
  state for at least 60 seconds;
- do not oscillate automatically between protocols;
- after stable HLS playback, offer **Try low latency again** and optionally run
  one infrequent automatic WebRTC probation when the page is visible;
- remember a successful manual compatibility choice for the browser session;
- clear failure history when the channel goes offline and starts a new publish
  session;
- keep authorization, codec support, publisher offline, and transport failure
  as separate reasons.

A background WebRTC probation temporarily consumes another reader session and
the full source bitrate. Keep it short and infrequent, and close it immediately
after success or timeout.

### 7. WebRTC has only one publicly reachable ICE transport

Production exposes static UDP 8189 only. It is efficient and should remain the
first choice, but networks that block or badly shape UDP go directly to HLS.
MediaMTX supports a static TCP ICE listener as the next connectivity option.

Enable `webrtcLocalTCPAddress: :8189` and expose TCP 8189 consistently through:

- the MediaMTX container port mapping;
- the OCI security list;
- UFW/cloud-init and the runbook.

The browser and OBS can then use TCP ICE when UDP cannot connect, without any
OBS profile change. TCP is a reachability fallback, not a quality upgrade: under
congestion it can accumulate delay due to reliable ordered delivery. Record the
selected candidate type in diagnostics so its effect can be measured.

Only add TURN after tests show that static UDP and TCP still fail for meaningful
viewer networks. For maximum restrictive-network reachability TURN/TLS usually
needs TCP 443, which conflicts with Caddy on the current single public IP. That
would require a second IP/host or a managed TURN service. Under the stated cost
constraint, proceed only if the complete design is confirmed Always Free before
provisioning; a paid managed TURN service is out of scope. Do not add a public
TURN relay without expiring credentials, bandwidth limits, monitoring, and an
egress-allowance review.

### 8. HLS is prevented from using HTTP/3

Caddy defaults to HTTP/1.1, HTTP/2, and HTTP/3, but the production Caddyfile
explicitly limits it to `h1 h2`. LL-HLS makes many playlist and part requests;
HTTP/3 can avoid cross-request TCP head-of-line blocking during packet loss,
while clients automatically retain HTTP/2 as fallback.

Enable `h3` and expose UDP 443 through Docker, the OCI security list, and UFW.
Verify the negotiated protocol from a real browser. Keep TCP 443 unchanged and
test with UDP 443 blocked to prove HTTP/2 fallback still works.

### 9. Existing diagnostics show totals, not actionable degradation

Cumulative `packetsLost` is hard to interpret and can even decrease according to
the WebRTC stats definition. It does not say whether 20 packets were lost out of
200 or 20 million. MediaMTX metrics are disabled, so publisher-side loss and
server-side discarded frames cannot be separated from viewer-side loss.

Enable MediaMTX's private metrics listener and collect, by path and session
state:

- publish-side inbound packets, packets lost, jitter, bytes, and MediaMTX path
  frames in error;
- read-side outbound frames discarded and bytes;
- HLS muxer frames discarded;
- active WebRTC/HLS sessions;
- host/container CPU, memory, network throughput, UDP receive errors, and socket
  drops.

Do not expose port 9998 publicly or retain viewer IP labels in a public-facing
dashboard.

The rolling frame-pacing slice is implemented for both HLS and WebRTC with
`requestVideoFrameCallback`; WebRTC also reads decoder, jitter-buffer, and
freeze counters from `getStats()`. Continue improving browser diagnostics to
calculate the remaining rolling deltas and rates:

- received packets and loss percentage by audio/video track;
- jitter, average jitter-buffer delay, and discarded-late packets;
- NACK, PLI, retransmitted packets, freeze count/duration, and concealed audio;
- buffer ahead and live-edge distance for HLS;
- selected transport/candidate type, recovery attempt, last progress time, and
  active protocol;
- session startup, first-frame, stall, recovery, and protocol-switch durations.

Keep an expandable technical panel, but show ordinary users only a concise state
such as **Playing**, **Recovering**, **Compatibility mode**, **Device cannot
decode this stream**, or **Publisher connection degraded**.

### 10. Buffer and queue tuning must be evidence-driven

The existing 2.5 MB `udpReadBufferSize` and matching kernel receive maximum are
already meaningful protections against local socket overflow. They cannot repair
loss on the internet path. Likewise, increasing `writeQueueSize` without a
`reader is too slow`/discard signal only consumes memory, and changing
`udpMaxPayloadSize` without an MTU problem can reduce efficiency.

During load and impairment tests:

- confirm the applied host socket limits and MediaMTX startup configuration;
- inspect kernel UDP receive errors and MediaMTX publish loss separately;
- increase receive buffers in measured steps only if the host is dropping
  bursts, keeping the sysctl maximum at least as large;
- increase `writeQueueSize` only when MediaMTX reports a full/slow reader queue
  or its discard metrics rise while network capacity remains adequate;
- lower `udpMaxPayloadSize` only when packet captures or path-MTU tests show
  fragmentation/black-holing, then test both publisher and reader paths.

### 11. Publisher stalls need a separate recovery path

The reported alt-tab/heavy-game failure can originate before MediaMTX. There are
three materially different cases:

1. The game stops rendering when minimized and OBS continues encoding a static
   frame. Media timestamps and bytes still advance; the backend cannot know
   whether the static picture is intentional without expensive content
   analysis. If desktop/window continuity is desired, the streamer must switch
   to the existing Desktop/Window Capture fallback or the managed scene design
   must be changed with explicit privacy review.
2. OBS render or encoder load spikes and output frame delivery degrades. Capture
   OBS render lag, encoding lag, skipped frames, GPU load, and send bitrate
   during a repeatable heavy-game/alt-tab test. Reserve GPU headroom or cross the
   relevant OBS evidence gate only after identifying which stage is saturated.
3. The WHIP session remains marked ready but inbound RTP packets/bytes stop.
   MediaMTX metrics can detect this backend-visible source stall. Alert first;
   after proving the signal reliable, consider a rate-limited publisher-session
   kick to invoke OBS automatic reconnect.

An automatic publisher kick must require several consecutive no-ingress
samples, must not trigger merely because the picture has little motion, and must
have a circuit breaker (for example, no more than two kicks in five minutes).
Validate manually in staging before enabling it. If audio or encoded video bytes
continue, a backend reconnect is unlikely to repair an alt-tab capture problem.

### 12. Service restart behavior is not yet part of the playback contract

MediaMTX has no Compose health check, and every deploy explicitly restarts it
even when neither its image nor configuration changed. The player should recover
from a necessary restart, but avoidable restarts still interrupt every publisher
and viewer.

- Add private health checks for MediaMTX's Control API and media listeners.
- Alert on repeated health failures before introducing an automatic restart
  loop that could flap.
- Remove the deployment script's unconditional MediaMTX restart; let Compose
  recreate it only for an image/configuration change.
- Validate MediaMTX configuration before replacing the running container.
- Treat a necessary single-node restart as an expected outage and verify that
  the browser automatically rejoins after OBS republishes.

## Implementation sequence

### Phase 0 — Establish a reproducible baseline

1. Pin the test matrix to the deployed MediaMTX 1.20.1, Caddy 2.11.4, and exact
   installed HLS.js version.
2. Record source codec, game resolution, canvas/output resolution, frame rate,
   bitrate, keyframe cadence, NVENC settings, and scene-item scaler without
   changing them during a comparison run.
3. Capture OBS output health (encoder overload, render/encode lag, dropped
   network frames, reconnects, and actual send bitrate) beside server metrics so
   a source fault is visible before any profile is changed.
4. Enable private MediaMTX metrics and capture a healthy 30-minute stream with
   one, five, and the expected maximum number of viewers.
5. Record WebRTC/HLS startup time, glass-to-glass latency, stalls, source and
   viewer packet loss, dropped frames, CPU, memory, and outbound bandwidth.
6. Reproduce alt-tab and a GPU-heavy game section from both native 1440p and 4K
   inputs while recording OBS render, encoder, and network health plus MediaMTX
   ingress deltas.
7. Run two 1440p60 12 Mbps publishers with ten viewers split across them and
   confirm that the current VM remains below CPU, network, socket-drop, and
   egress-allowance thresholds.
8. Save the results and exact test commands under `docs/` so later tuning has a
   comparable baseline.

Exit criterion: ingest loss, server discard, viewer loss, decode overload, and
insufficient bandwidth can be told apart from the collected evidence.

### Phase 1 — Low-risk delivery-path resilience

1. Turn on warm HLS remuxing and verify resource use.
2. Add TCP 8189 ICE fallback end-to-end.
3. Re-enable Caddy HTTP/3 and expose UDP 443 end-to-end.
4. Add MediaMTX health checks and stop unconditional deploy restarts.
5. Validate UDP-first WebRTC, TCP fallback, HTTP/3 HLS, and HTTP/2 fallback.

Exit criterion: all transports are reachable as designed, healthy-path quality
and latency do not regress, and HLS fallback begins from a warm muxer.

### Phase 2 — Make recovery deterministic

1. Introduce a framework-independent playback/recovery controller with typed
   reasons, timers, backoff, stable-window resets, and circuit breaking.
2. Pin/wrap the WHEP reader and make it the single owner of WebRTC recovery.
3. Implement make-before-break WebRTC reconnection and first-frame validation.
4. Implement HLS.js and native-HLS progress watchdogs and instance recreation.
5. Make robust HLS the default for existing and new channels; expose WebRTC as
   the viewer-selected low-latency mode.
6. Integrate the protocol state machine into `LivePlayer` and preserve the last
   frame during brief recovery.
7. Keep user pause, hidden tabs, offline streams, authorization expiry, and
   unsupported codecs outside the generic retry loop.

Exit criterion: every tested transient either recovers automatically or lands
in the correct actionable terminal state; no path stays frozen indefinitely.

### Phase 3 — Tune latency against stability

1. Remove the current one-second HLS live-sync override and use manifest-driven
   defaults as the first candidate.
2. Run the impairment matrix, then change one HLS latency/load-policy value at a
   time.
3. Choose the lowest stable configuration whose measured glass-to-glass latency
   stays within the accepted 3-5 second range, not the smallest number that works
   on an ideal LAN.
4. Tune MediaMTX/kernel queues only when their specific drop signals prove a
   local bottleneck.
5. Decide from measured failures whether TURN is warranted.
6. If evidence crosses an OBS decision gate, A/B-test exactly one source setting
   against the unchanged baseline and rerun both publisher- and viewer-side
   impairment cases before accepting it.

Exit criterion: selected values and their tradeoffs are documented with before
and after measurements.

### Phase 4 — Operationalize quality

1. Add rolling browser quality metrics and a compact support export with no
   credentials or persistent viewer identifiers.
2. Add alerts for publisher loss, frames in error/discarded, restart loops,
   resource saturation, and outbound-capacity thresholds.
3. Add a publisher no-ingress alert and collect enough evidence to decide
   whether a rate-limited automatic WHIP-session kick is safe.
4. Add a runbook that maps each signal to the correct action; do not tell a
   publisher to reduce bitrate when the evidence shows only one viewer's path is
   bad.
5. Review MediaMTX and HLS.js release notes before upgrades and rerun the
   impairment suite after each transport/player upgrade.

### Phase 5 — Optional multi-rendition architecture spike

Run this only if the single source rendition remains the demonstrated blocker
after Phases 0-4.

1. Confirm the deployed OBS and MediaMTX versions accept two WHIP simulcast
   layers and measure publisher GPU/upload overhead.
2. Prove that MediaMTX exposes the layers as distinct tracks, then prototype
   stream-copy extraction to separate high/low paths; do not transcode on the
   application VM.
3. Build deliberate rendition selection into WHEP/HLS. Do not assume MediaMTX's
   browser WHEP output performs simulcast adaptation in version 1.20.1.
4. Preserve the current full-resolution/full-bitrate layer as the default for a
   healthy viewer, use a lower layer only under sustained bandwidth/decode
   pressure, and add hysteresis before promotion.
5. Compare this design with the operational cost of a GPU transcoder or managed
   service before production adoption.

Exit criterion: a weak viewer can move to a lower rendition without disrupting
the publisher or reducing the quality delivered to a healthy viewer.

## Verification and impairment matrix

Do not rely on browser DevTools throttling for WebRTC; it does not reliably
impair the separate UDP media path. Use a staging VM/network namespace or a
controlled router with `tc netem`. Never apply impairment rules to the
production SSH path.

Test publisher-to-server and server-to-viewer impairment separately:

| Scenario | Expected behavior |
| --- | --- |
| Healthy default playback | Full 2560x1440/60 source presentation, HLS smooth mode, measured latency within 3-5 seconds |
| Viewer selects low latency on healthy UDP | WebRTC starts at full source quality and can return to HLS without a page reload |
| 1% random viewer loss with modest jitter | Browser absorbs loss; no protocol switch solely because a counter increased |
| 3-5% random/burst viewer loss | No permanent freeze; bounded repair, then warm HLS if rendered frames stop |
| Two-second viewer outage | Automatic recovery without page reload or full-screen error |
| Ten-second viewer outage | Backoff remains active; HLS or rebuilt WebRTC resumes after connectivity returns |
| Network changes Wi-Fi to mobile/LAN | Old peer is replaced and playback resumes without remounting the page |
| UDP 8189 blocked | WebRTC uses TCP 8189 or reaches warm HLS within the failure budget |
| UDP 8189 and TCP 8189 blocked | HLS starts automatically over HTTPS |
| UDP 443 blocked | HLS continues over HTTP/2 on TCP 443 |
| Publisher packet loss | Server metrics identify ingest loss affecting all viewers; UI does not blame an individual viewer |
| Streamer alt-tabs | OBS and server evidence distinguishes intentional/static capture from halted packet flow; backend does not enter a kick loop |
| GPU-heavy game section | OBS render/encode lag is recorded and the precise source bottleneck is identified before settings change |
| Repeatable foliage clip, native 1440p | P5/qres/AQ baseline holds 60 fps with no render or encode lag and no new HLS/WebRTC decode failures |
| Same repeatable foliage clip, 4K input | Area scaling produces stable 1440p output without scaler shimmer or additional render lag |
| NVIDIA AV1 with two B-frames | Chrome and Firefox play both WHEP and HLS, recover after loss, and stay synchronized; otherwise roll back to zero |
| Publisher stops and returns | Page shows offline accurately and rejoins the new publish session automatically |
| MediaMTX restart | Browser continues retrying and rejoins after OBS republishes |
| User pauses or backgrounds tab | No reconnect storm, false stall, or protocol flip |
| Session expires | Retries stop and sign-in action is shown |
| Unsupported/overloaded decoder | Codec/device explanation is shown; transport retries do not loop forever |
| Two publishers and ten total viewers at 12 Mbps each | No queue discard/resource saturation; each viewer retains source resolution; both warm muxers remain healthy; total outbound rate and monthly allowance projection remain visible |

Include Chrome, Firefox, Safari, iOS Safari, and Android Chrome where available,
and test every OBS codec profile that is actually used. Codec success on one
browser/OS/GPU combination must not be generalized to another.

## Initial service-level objectives

These are starting targets to validate and revise with baseline data:

- healthy WebRTC first rendered frame: p95 at or below 4 seconds;
- warm HLS first rendered frame: p95 at or below 5 seconds;
- healthy HLS glass-to-glass latency remains between 3 and 5 seconds;
- two-second viewer outage: playback resumes within 6 seconds of connectivity
  returning, without manual action;
- ten-second outage: playback resumes within 12 seconds of connectivity
  returning, without manual action;
- no permanent frozen-video state while channel status remains live;
- no silent quality reduction: a healthy capable viewer receives the top source
  rendition, and any future adaptive downshift follows an explicitly adopted
  policy;
- no protocol oscillation: at most one automatic WebRTC-to-HLS transition per
  60-second circuit-breaker window;
- after recovery, audio and video both progress and remain synchronized;
- parallel reconnect sessions close within five seconds and reader counts return
  to the steady value;
- healthy playback does not increase MediaMTX frame-error/discard counters.

## Prioritized work list

| Priority | Work | Expected impact | Risk/cost |
| --- | --- | --- | --- |
| P0 | Enable metrics and build the impairment baseline | Prevents blind tuning and separates publisher, server, viewer, and decoder faults | Low |
| P0 | Validate setup 1.2.0 OBS quality baseline | Confirms Area scaling and NVIDIA AV1 B-frames improve compression without overloading a 5060 Ti or breaking WHEP | Requires Windows/NVIDIA and browser matrix; B-frames have an immediate zero-frame rollback |
| P0 | Make robust LL-HLS the default smooth mode | Uses the accepted latency budget to absorb spotty viewer Wi-Fi without changing encoded quality | Moderate behavior/migration change |
| P0 | Warm LL-HLS with `hlsAlwaysRemux` | Removes avoidable fallback startup delay | Low to moderate resource use |
| P0 | Replace finite HLS retries with progress-aware recovery | Prevents indefinite frozen/error states | Moderate client complexity |
| P0 | Unify WebRTC recovery under one state machine | Predictable repair and fallback behavior | Moderate/high; WHEP integration must preserve codec logic |
| P1 | Relax ultra-low HLS live-edge settings based on tests | Fewer stalls on imperfect links with unchanged encoded quality | Adds a few seconds of fallback latency |
| P1 | Add TCP 8189 ICE fallback | WebRTC reachability on UDP-blocked networks | TCP can accumulate latency under congestion |
| P1 | Enable HTTP/3/UDP 443 | Better LL-HLS behavior under HTTP packet loss; HTTP/2 remains fallback | Firewall/deployment change |
| P1 | Make-before-break WebRTC repair and non-disruptive UI | Shorter visible interruptions | Temporary duplicate session/bandwidth |
| P1 | Rolling browser quality metrics | Faster diagnosis and safer tuning | Privacy/cardinality design required |
| P1 | OBS/MediaMTX publisher-stall diagnostics | Separates alt-tab capture, GPU starvation, and stopped WHIP ingress | Requires synchronized OBS and server evidence |
| P1, evidence-gated | OBS bitrate/GOP/codec/reconnect correction | Removes a proven publisher-side or decode blocker that the backend cannot repair | Can reduce source efficiency/quality; change one variable only |
| P2 | Health checks and deploy restart cleanup | Fewer avoidable global interruptions | Low/moderate operational change |
| P2 | TURN/TLS | Reaches the most restrictive networks | Extra IP/service, bandwidth, security, and cost |
| Future | OBS simulcast with explicit layer extraction/selection | Adaptive playback without server re-encoding while retaining the top layer | MediaMTX browser egress is not adaptive today; extra publisher GPU/upload and substantial integration work |
| Future | GPU-backed adaptive renditions | Smooth playback below source bitrate and wider compatibility | New media architecture; not feasible on current VM CPU |

## Files expected to change during implementation

- `components/live-player.tsx`: protocol state machine and circuit breaker.
- `components/webrtc-player.tsx`: single recovery owner, make-before-break, and
  typed playback events.
- `components/hls-player.tsx`: stable live-edge policy, progress watchdog, and
  indefinite bounded retry while live.
- `components/playback-stats.tsx`: rolling loss/quality and selected-transport
  metrics.
- a new client-only playback controller and pinned WHEP module with focused unit
  tests.
- a database migration and channel provisioning changes to make HLS the default
  while preserving an explicit WebRTC viewer choice.
- `deploy/oracle/mediamtx.yml.example`: metrics, warm HLS, and TCP ICE.
- `deploy/oracle/docker-compose.yml`: TCP 8189, UDP 443, metrics isolation, and
  health checks.
- `deploy/oracle/Caddyfile`: HTTP/3 and media-specific proxy validation.
- `deploy/oracle/terraform/main.tf` and
  `deploy/oracle/terraform/cloud-init.yaml.tftpl`: matching security-list/UFW
  rules.
- `deploy/oracle/deploy.sh` and deployment docs: configuration validation,
  restart policy, diagnostics, and rollback.
- `scripts/windows/setup-frankerzspam-obs.ps1`, its generated launcher, and OBS
  documentation/tests for the selected setup 1.2.0 baseline and any later OBS
  decision-gate change.
- component, integration, and Playwright tests, plus a documented external
  impairment harness.

## Rollout and rollback

Ship one layer at a time: observability, warm HLS, connectivity transports,
recovery controller, then latency tuning. Run the healthy and impaired smoke
suite after each layer.

Keep these independent rollback switches:

- disable HTTP/3 by returning Caddy to `h1 h2` while retaining TCP HTTPS;
- disable TCP ICE while retaining UDP 8189 and HLS;
- turn off `hlsAlwaysRemux` if measured resource use is unacceptable;
- restore manifest-driven/default HLS latency values;
- restore NVIDIA AV1 to zero B-frames if WHEP/HLS compatibility regresses;
- restore Lanczos scene-item scaling from the managed backup if Area loses too
  much desired detail in the controlled comparison;
- restore the current WebRTC-first/HLS-only fallback component while retaining
  server metrics.

Do not roll back observability when rolling back a playback change; its evidence
is needed to confirm recovery.

## Primary references

Reviewed on 2026-09-02. Recheck version-specific behavior during implementation.

- [MediaMTX: decrease packet loss](https://mediamtx.org/docs/features/decrease-packet-loss)
- [MediaMTX: WebRTC connectivity and TURN](https://mediamtx.org/docs/features/webrtc-specific-features)
- [MediaMTX: configuration reference](https://mediamtx.org/docs/references/configuration-file)
- [MediaMTX: metrics](https://mediamtx.org/docs/features/metrics)
- [MediaMTX: browser playback and WHEP reader](https://mediamtx.org/docs/read/web-browsers)
- [HLS.js API and live/retry tuning](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [Video frame presentation callback specification](https://wicg.github.io/video-rvfc/)
- [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/)
- [Caddy protocol configuration](https://caddyserver.com/docs/caddyfile/options#protocols)
- [OBS WHIP and simulcast guide](https://obsproject.com/kb/whip-streaming-guide)
- [OBS NVENC defaults and property names](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-nvenc/nvenc-properties.c)
- [OBS advanced NVENC options](https://obsproject.com/kb/advanced-nvenc-options)
- [OBS scale-filter implementation](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/scale-filter.c)
- [OBS output reconnect API](https://docs.obsproject.com/reference-outputs#c.obs_output_set_reconnect_settings)
- [OBS WHIP implementation](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-webrtc/whip-output.cpp)
- [NVIDIA RTX 5060 family encoder specification](https://www.nvidia.com/en-eu/geforce/graphics-cards/50-series/rtx-5060-family/)
- [MediaMTX maintainer note on OBS simulcast ingest versus browser egress](https://github.com/bluenviron/mediamtx/discussions/5594)
- [OCI Always Free resources and outbound transfer](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [OCI A1 free monthly OCPU and memory allowances](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm)
- [OCI compute shape network bandwidth](https://docs.oracle.com/en-us/iaas/Content/Compute/References/computeshapes.htm)
