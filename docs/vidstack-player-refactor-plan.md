# Vidstack player refactor plan

> Historical design record; non-authoritative.
> [`config/streaming-contract.v1.json`](../config/streaming-contract.v1.json)
> defines current timing and resilience policy.

Status: implemented on 2026-09-02. Automated verification is complete. The
long-running live-source matrix remains an operational check because it needs
an active OBS stream and real devices.

Research baseline: 2026-09-02. Recheck the npm release channel and Vidstack API
before implementation because the React-19-compatible release is currently on
the npm `next` tag rather than `latest`.

## Implementation record

The implementation uses `@vidstack/react@1.15.6` and keeps
`hls.js@1.7.1` as a direct dependency. `components/vidstack-player.tsx` owns
`MediaPlayer`, `MediaProvider`, the local hls.js provider setup, and the shared
controls. The HLS and WebRTC components keep their transport, recovery, SLO,
fallback, and diagnostics code.

The player has play, pause, mute, volume, Live, picture-in-picture, and
fullscreen controls. Unsupported controls hide. Seeking and playback-rate
controls are absent. Vidstack owns the media source and the native video
element. The existing diagnostics receive that video element through a stable
callback.

The implementation differs from the proposed rollout in one respect. It does
not ship a second legacy player or a `PLAYER_IMPLEMENTATION` selector. Keeping
both implementations would add dead production code and require two recovery
test matrices. Roll back by deploying the previous Git commit. The change does
not alter the database, MediaMTX, OBS, stream keys, or media URLs.

The final production build adds 79,880 bytes gzip to the watch route. The route
is 320,480 bytes gzip, compared with 240,600 bytes at commit `a8f1969`. The
increase stays below the plan's 100 kB investigation threshold. `npm ls` shows
one `@vidstack/react` version and one `hls.js` version. Browser inspection found
no player CDN requests.

Automated checks cover the shared provider adapter, all existing HLS profiles
and SLO behavior, WebRTC repair, transport fallback, desktop Chromium, Pixel 7
layout, and 320 px overflow. The live acceptance matrix below still applies
when an OBS source is available.

## Objective

Replace the current native `<video controls>` presentation with a consistent,
accessible Vidstack control surface for HLS and WebRTC without weakening any
playback, security, recovery, or latency guarantee.

The refactor succeeds only when:

- HLS still uses the locally installed hls.js engine and the exact existing
  Ultra-low, Balanced, and Smooth configurations;
- HLS ≤2s still targets 1.2 seconds, limits forward loading to 1.8 seconds,
  treats two seconds as the maximum viewer latency and forward-buffer SLO, and
  leaves the mode after repeated instability;
- WebRTC still uses the pinned MediaMTX WHEP reader, performs bounded
  make-before-break repair, and falls back to warm Smooth HLS;
- the native media element remains available to the existing diagnostics and
  frame-progress watchdogs;
- all existing authorization, codec fallback, offline, pause, hidden-tab,
  reconnect, and support-snapshot behavior remains intact;
- the new controls are keyboard, touch, and screen-reader usable at desktop and
  320 px mobile widths;
- no Vidstack or hls.js runtime is fetched from a third-party CDN;
- deployment can switch back to the legacy player without a database,
  MediaMTX, OBS, or stream-key change.

Vidstack is not expected to reduce latency. The reason for this migration is a
better and consistent player UI, accessible controls, normalized player state,
and a proper live-edge control. hls.js and the existing application watchdogs
remain responsible for the two-second HLS behavior.

## Pre-refactor implementation

The current player is split across four large client components:

- `components/live-player.tsx` selects the playback mode, persists the session
  preference, and coordinates fallback between transports;
- `components/hls-player.tsx` creates and owns hls.js or native HLS, implements
  recovery and the two-second SLO, renders status overlays, and renders a native
  `<video controls>` element;
- `components/webrtc-player.tsx` loads the pinned MediaMTX reader, attaches its
  `MediaStream` to `video.srcObject`, monitors decoded frames, repairs WHEP, and
  renders a second native `<video controls>` element;
- `components/playback-stats.tsx` reads the native video element and optional
  hls.js/RTCPeerConnection diagnostics.

This code already contains behavior that a general-purpose player does not
replace:

- application-specific HLS profiles and profile switching;
- MediaMTX playlist timing validation;
- a 250 ms HLS ≤2s latency and forward-buffer watchdog;
- explicit corrective seeks and bounded hls.js recreation;
- authorization-aware recovery;
- compatibility-source switching for unsupported codecs;
- WHEP reader loading and peer-connection diagnostics;
- progress-aware WebRTC repair and transport fallback;
- privacy-filtered support diagnostics.

The refactor must wrap or adapt these behaviors. It must not delete them in
favor of Vidstack defaults.

## Dependency decision and compatibility gate

At the research baseline:

- npm `@vidstack/react@latest` resolves to `0.6.15` and declares React 18-only
  peer dependencies;
- npm `@vidstack/react@next` resolves to `1.15.6`, supports React 18 or 19 and
  `@types/react` 18 or 19, requires Node 18+, and is MIT licensed;
- this repository uses React 19.2, TypeScript 6, Next.js 16.3, and Node 24 in
  production.

Do not install `@vidstack/react` without a version. The first implementation
step must re-query npm. Use the stable tag if it supports React 19 by then;
otherwise pin the exact tested `1.x` version from `next`, currently `1.15.6`:

```sh
npm install --save-exact @vidstack/react@1.15.6
```

Keep the direct `hls.js` dependency. Configure Vidstack to use that local copy
instead of its optional CDN loader, and confirm `npm ls hls.js` resolves to one
runtime version.

The dependency spike is a stop/go gate. Stop the migration if any of these
cannot be demonstrated in an isolated branch:

1. `npm install` completes without forced peer-dependency overrides.
2. `npm run typecheck`, `npm run lint`, and `npm run build` pass under React 19,
   TypeScript 6, Next.js 16, and the production Node image.
3. A client-only test page renders without a hydration error.
4. The HLS provider exposes its hls.js instance before source loading, accepts
   the complete existing `HlsConfig`, and unloads cleanly.
5. The video provider accepts a `MediaStream` object and exposes the underlying
   `HTMLVideoElement` without replacing it during a stream update.
6. Only watch/player routes load the Vidstack JavaScript and CSS.
7. No request is made to JSDelivr or another player CDN.

If the `next` release is unstable or fails the gate, keep the current player
and revisit after Vidstack promotes a React-19-compatible version to `latest`.
Do not downgrade React or Next.js solely to adopt the player.

## Scope and non-goals

### In scope

- Vidstack React player/provider integration;
- a custom Vidstack control layout matching this application's design;
- one shared visual shell for HLS and WebRTC;
- a Live/Go-live control for HLS;
- normalized play, pause, mute, volume, fullscreen, picture-in-picture,
  buffering, and autoplay state;
- extraction of transport logic from visual markup where needed;
- migration of current unit, integration, and browser tests;
- a temporary runtime rollback selector for one production release.

### Not in scope

- changing MediaMTX, OBS, segment, part, keyframe, codec, bitrate, or rendition
  settings;
- replacing hls.js with a different HLS engine;
- replacing the MediaMTX WHEP reader or changing WebRTC signaling;
- adding DASH, DRM, ads, DVR promises, transcoding, or adaptive renditions;
- adding playback-rate controls, seeking controls, or a time slider;
- enabling Google Cast or AirPlay before authenticated receiver playback is
  designed and tested;
- changing the four playback modes or their persistence semantics;
- changing the existing support-snapshot schema except for a player UI/version
  field if useful during rollout.

Remote playback is deliberately excluded. The media routes depend on the
viewer's authenticated browser session, which a cast receiver will not inherit.
Exposing Cast or AirPlay controls before that authorization flow exists would
offer a control that cannot reliably play the stream.

## Selected target architecture

Keep transport selection in `LivePlayer`, keep HLS and WebRTC controllers
separate, and share only the Vidstack presentation layer:

```text
LivePlayer
├── playback mode/session preference/fallback policy
├── VidstackHlsPlayer
│   ├── HLS profile + source selection
│   ├── Vidstack HLS provider
│   ├── local hls.js instance + existing recovery/SLO controller
│   └── VidstackPlayerFrame
└── VidstackWebRtcPlayer
    ├── MediaMTX WHEP reader + existing recovery controller
    ├── MediaStream source + RTCPeerConnection diagnostics
    └── VidstackPlayerFrame

VidstackPlayerFrame
├── MediaPlayer
├── MediaProvider (owns the native video element)
├── PlayerStatusOverlay
├── protocol/profile badge
├── custom VidstackControls
└── existing PlaybackStats below the frame
```

Do not merge HLS and WebRTC into one transport state machine. Their failure,
authorization, and recovery semantics differ. A shared shell should remove
duplicate markup without coupling their controllers.

Suggested file boundaries:

- `components/player/hls-profiles.ts`: pure profile constants and types;
- `components/player/vidstack-player-frame.tsx`: `MediaPlayer`,
  `MediaProvider`, overlay slots, protocol badge, and native video ref bridge;
- `components/player/vidstack-controls.tsx`: accessible controls and tooltips;
- `components/player/player-status-overlay.tsx`: offline/loading/reconnecting,
  unauthorized, unsupported, and retry states;
- `components/player/vidstack-hls-player.tsx`: HLS provider adapter and existing
  HLS recovery/SLO controller;
- `components/player/vidstack-webrtc-player.tsx`: MediaStream adapter around the
  existing WHEP controller;
- `components/player/player-types.ts`: shared UI state only;
- existing `components/playback-stats.tsx`: retained initially, then simplified
  only after parity is proven.

The exact names may change during implementation, but engine logic, UI logic,
and diagnostics must have explicit ownership.

## Shared Vidstack frame and controls

Use Vidstack's headless React primitives, not the complete default layout. The
default layout includes features this live-only product should not expose, and
importing the entire layout makes bundle control harder.

The control bar should contain:

- Play/Pause;
- Mute/Unmute;
- volume slider on layouts wide enough to use it safely;
- Live/Go live for HLS, and a non-interactive Live indicator for WebRTC;
- picture-in-picture when supported;
- fullscreen when supported.

Do not render:

- a duration or current-time display;
- a time slider or seek-forward/seek-back buttons;
- playback-rate controls, because hls.js owns small catch-up rate changes;
- a quality menu while only one rendition exists;
- empty captions or audio-track menus;
- Cast/AirPlay controls during this migration.

Set these player behaviors explicitly rather than accepting library defaults:

- `viewType="video"`;
- live stream type appropriate to the transport;
- `load="eager"`, because the live player is the primary watch-page content and
  the current implementation joins immediately;
- muted autoplay and `playsInline`;
- the current poster;
- native controls disabled after Vidstack controls are mounted;
- seeking keyboard shortcuts disabled;
- no scrub gesture;
- controls remain reachable while autoplay is blocked;
- controls and focus are hidden or inert behind a blocking status overlay.

For HLS, configure the live-edge tolerance against the active profile rather
than accepting Vidstack's ten-second default. The Live button must seek to
hls.js `liveSyncPosition`, not claim that a position ten seconds behind the
edge is live. Treat the short sliding playlist as an internal live-DVR window
only if required for Vidstack's Live button; do not expose general seeking.

Use Vidstack state/hooks for UI-only state such as paused, muted, fullscreen,
picture-in-picture, controls visibility, and autoplay failure. Continue using
refs or direct subscriptions for the 250 ms SLO watchdog so it does not cause
four React renders per second.

## Native media-element bridge

`PlaybackStats`, frame callbacks, native live-edge fallback, and the WebRTC
watchdog require the actual `HTMLVideoElement`.

`VidstackPlayerFrame` must expose the provider's video element through a stable
callback or mutable ref once the HLS/video provider is ready. Consumers must
receive `null` on provider teardown. The bridge must not query the DOM by class
or tag name.

Acceptance rules:

- only one video element exists in a player frame;
- changing HLS profile or WebRTC stream does not leave an orphan element;
- `PlaybackStats` receives the same element that renders the media;
- `requestVideoFrameCallback`, `getVideoPlaybackQuality`, `buffered`,
  `seekable`, `currentTime`, `paused`, `ended`, and `readyState` remain usable;
- all native listeners and provider subscriptions are removed during unmount
  and source/mode changes.

## HLS migration

### Provider ownership

Pass an explicit HLS MIME type with the source because MediaMTX URLs may not end
in `.m3u8`. Configure the Vidstack HLS provider during `onProviderChange`,
before provider setup/source loading:

- point its library option at the local `hls.js` dependency;
- assign the exact active profile configuration;
- obtain the created instance through `provider.onInstance`;
- subscribe to required typed hls.js events;
- clear the instance and all subscriptions when Vidstack destroys the provider.

Vidstack should own ordinary hls.js creation and destruction. The application
continues to own policy. One media-error repair may still call
`recoverMediaError()` on the exposed instance. Fatal recreation should remount
or reload the Vidstack provider through one documented generation mechanism;
do not call `destroy()` behind Vidstack's back and leave its provider holding a
dead instance.

The dependency spike must identify and test that recreation mechanism before
the legacy HLS component is removed.

### Required profile parity

Preserve these current settings exactly:

| Profile | Target | Maximum | Forward load limit | Back buffer | Catch-up |
| --- | ---: | ---: | ---: | ---: | ---: |
| HLS ≤2s | 1.2 s | 2 s | 1.8 s | 0 s | 1.05x |
| Balanced | 3 s | 6 s | existing/default | 30 s | 1.03x |
| Smooth | 5 s | 9 s | existing/default | 30 s | 1.02x |

All profiles must retain `lowLatencyMode: true`, edge sync, their current stall
growth values, the existing native-HLS policy, and the current compatibility
source behavior.

### Required HLS behavior parity

Port and test every existing rule:

1. Prefer hls.js whenever MSE/MMS supports it.
2. Reject native HLS for HLS ≤2s because native buffering cannot honor the
   advertised limits.
3. Allow native HLS only for Balanced or Smooth when hls.js is unavailable.
4. Validate one-second target duration and parts no longer than 250 ms before
   continuing to advertise HLS ≤2s.
5. Sample hls.js latency and native forward buffer every 250 ms during active,
   visible, online playback.
6. Do not enforce the SLO while paused, seeking, hidden, offline, or before
   playback begins.
7. Correct latency above two seconds once by seeking to `liveSyncPosition`.
8. Recreate the provider if the breach persists for one second.
9. Record latency and forward-buffer episodes, peaks, last breach, corrective
   seeks, and exit reason without high-frequency React rendering.
10. Do not seek only because the forward buffer is above two seconds.
11. Leave HLS ≤2s for Balanced after two stalls/recoveries in 30 seconds.
12. Preserve bounded network retry, one media-error repair, codec detection,
    session-expiry handling, visibility/online resume, and stable-play reset.
13. Preserve the AV1-to-compatibility-source control and error messaging.

Vidstack's buffering or error state may drive visual controls, but it must not
replace these application-specific recovery decisions.

## WebRTC migration

Vidstack's video provider accepts `MediaStream` objects. Refactor the WHEP
controller to publish the current stream as a Vidstack `video/object` source
instead of assigning `video.srcObject` directly.

Keep these behaviors unchanged:

- load the same-origin pinned `/vendor/mediamtx-reader-1.20.1.js` script;
- use the same channel-specific WHEP URL;
- retain the active reader and old reader during make-before-break repair;
- swap Vidstack to the replacement `MediaStream` without remounting the entire
  watch page;
- close the old reader only after the replacement video produces its first
  frame;
- keep the one-second decoded/presented-frame watchdog;
- ignore intentional pause and hidden-tab inactivity;
- reset recovery count after 60 seconds of stable progress;
- retain missing-audio detection when audio is expected;
- retain authorization checks, reader timeouts, and Smooth-HLS fallback;
- keep the `RTCPeerConnection` available to `PlaybackStats`.

The spike must prove that updating a Vidstack object source does not clone,
stop, or replace tracks unexpectedly. Reader closure, not Vidstack, remains
responsible for terminating the remote MediaStream lifecycle.

For WebRTC, display Live as a status rather than a seek action. There is no
seekable live window to jump through.

## Status overlays and mode selector

Keep the four mode buttons outside `MediaPlayer`. They choose the transport and
must remain available when a provider cannot initialize.

Move duplicated overlay markup into `PlayerStatusOverlay`, but preserve the
current messages and actions for:

- stream offline;
- initial join;
- reconnecting;
- unsupported codec/device;
- compatibility-stream retry;
- playback interrupted/manual retry;
- expired session/sign-in;
- WebRTC unavailable before Smooth fallback.

Overlay state remains owned by the HLS/WebRTC controller. Vidstack events may
update it but must not collapse authorization, unsupported-codec, transport
failure, and offline into one generic error.

Keep the existing protocol/profile badge and playback-mode explanation. The
new Live control is player navigation; it does not replace the mode selector.

## Diagnostics and support snapshot

Preserve all current diagnostics during the first migration:

- hls.js/native engine label;
- active profile target and maximum;
- estimated live latency and forward buffer;
- hls.js load limit and observed maxima;
- segment, part, and hold-back timing;
- playback rate and last correction;
- breach and corrective-seek counters;
- profile exit reason;
- WebRTC peer/codec/packet/frame/transport statistics;
- safe copyable support snapshot.

Add only two rollout fields if useful:

- `playerUi: "legacy" | "vidstack"`;
- exact Vidstack version from a build-time constant.

Do not add media URLs, query strings, cookies, session identifiers, local IP
addresses, or raw ICE candidates.

After parity, evaluate whether low-frequency Vidstack state can replace some
duplicated native event bookkeeping. Do not combine that cleanup with the
initial provider migration; separate changes make regressions diagnosable.

## Implementation phases

### Phase 0: dependency and lifecycle spike

1. Recheck npm tags, React peers, license, and Vidstack's current migration
   notes.
2. Read the installed Next.js 16 guides for client components, dynamic imports,
   CSS, and third-party libraries before writing application code.
3. Install an exact React-19-compatible Vidstack version.
4. Create a temporary development harness for one HLS source and one synthetic
   `MediaStream`.
5. Prove local hls.js injection, pre-load configuration, instance access,
   instance recreation, native video access, MediaStream replacement, teardown,
   eager loading, muted autoplay, and production build behavior.
6. Measure the player route's JavaScript/CSS before and after the minimal
   import. Confirm non-player routes do not load it.
7. Delete the harness after recording the decisions in this plan or an
   implementation note.

Exit criterion: every compatibility gate passes without peer overrides,
hydration warnings, CDN requests, duplicate hls.js instances, or leaked media
elements.

### Phase 1: freeze and isolate current contracts

1. Move HLS profile constants/types to a pure module without changing values.
2. Extract shared playback-state and overlay types without changing rendered
   behavior.
3. Add missing characterization tests before moving engine code.
4. Record baseline bundle size, first-frame time, five-minute HLS latency and
   buffer peaks, WebRTC startup time, and recovery outcomes.

Exit criterion: tests describe all behaviors listed in this document and the
legacy player still passes unchanged.

### Phase 2: shared Vidstack frame and controls

1. Add `VidstackPlayerFrame` and the native video-element bridge.
2. Compose the minimal custom controls.
3. Add tooltips, visible focus, touch targets, reduced-motion behavior, and
   control auto-hide.
4. Add shared overlays and the existing protocol badge.
5. Keep the frame behind the temporary rollout selector; do not delete native
   player components.

Exit criterion: keyboard, screen-reader roles, mobile sizing, autoplay failure,
fullscreen, PiP, mute/volume, overlay focus, and cleanup tests pass with a plain
video source.

### Phase 3: HLS provider migration

1. Adapt HLS source selection and capability detection to Vidstack.
2. Configure the provider with the local hls.js copy and exact profile config.
3. Port instance event subscriptions and recovery policy.
4. Port the playlist timing gate and 250 ms SLO watchdog.
5. Port native HLS and compatibility-source paths.
6. Feed the provider's native element and hls.js instance to diagnostics.
7. Run the entire HLS test matrix against both legacy and Vidstack variants.

Exit criterion: configuration objects, events, timing gates, SLO counters,
corrective actions, mode fallback, support snapshot, and visible behavior match
the legacy player. Healthy HLS ≤2s measurements must not regress.

### Phase 4: WebRTC provider migration

1. Extract the MediaMTX reader/recovery controller from its `<video>` markup.
2. Supply its `MediaStream` to Vidstack's video provider.
3. Bridge the underlying element and peer connection to diagnostics.
4. Port make-before-break retirement, progress watchdog, audio detection,
   authorization, and fallback.
5. Verify rapid mode changes cannot retain a reader, peer connection, timer,
   MediaStream, or Vidstack provider from the previous mode.

Exit criterion: WebRTC startup, repair, fallback, cleanup, and diagnostics
match the legacy player under success and failure tests.

### Phase 5: controlled cutover and cleanup

1. Add a temporary server-side `PLAYER_IMPLEMENTATION=legacy|vidstack` setting,
   pass the non-secret choice into the watch-page client boundary, and split the
   implementations so legacy code is not downloaded in the Vidstack path.
2. Deploy with `legacy` as the default and exercise Vidstack in staging against
   production-like HLS and WebRTC sources.
3. Switch production to Vidstack after automated and live acceptance passes.
4. Keep the legacy implementation for one release window.
5. Remove legacy components, the temporary selector, duplicate CSS, and tests
   only after the rollback window closes.
6. Run a second cleanup review that replaces only clearly redundant UI-state
   listeners with Vidstack state subscriptions.

Exit criterion: production runs Vidstack, rollback has not been needed during
the agreed observation window, and the final bundle contains one implementation
and one hls.js runtime.

## Automated test plan

### Unit/component coverage

Retain or add tests for:

- exact HLS configuration for all three profiles;
- local hls.js provider configuration before source load;
- one active hls.js instance and complete cleanup on profile/source changes;
- native HLS allowed for Balanced/Smooth and rejected for HLS ≤2s;
- one-second/250 ms playlist contract validation;
- two-second latency correction and one-second persistent-breach recreation;
- no SLO action while paused, hidden, offline, seeking, or not ready;
- no corrective seek for a forward-buffer-only breach;
- repeated-stall fallback and persisted Balanced selection;
- bounded network/media retry and stable-play reset;
- compatibility-source switch and session-expiry UI;
- Vidstack player eager load, muted autoplay, and underlying element bridge;
- Play/Pause, Mute, volume, Live, PiP, and Fullscreen controls;
- absence of time, seek, playback-rate, cast, and empty quality controls;
- focus trapping/inert behavior under blocking overlays;
- WHEP reader success, failure, replacement, cleanup, audio timeout, and Smooth
  fallback through a MediaStream source;
- unchanged support snapshot redaction.

Mock Vidstack at provider boundaries for deterministic state-machine tests, but
include a smaller set of tests with the real package so mocks cannot hide an API
or lifecycle mismatch.

### Browser coverage

The current Playwright suite covers desktop Chromium and a Pixel 7 profile.
The migration must add focused player runs for Firefox and WebKit because
provider choice, PiP/fullscreen support, native HLS, and media-element events
are browser-specific.

Verify:

- no hydration or console errors;
- controls fit at 320 px without horizontal overflow;
- touch targets remain usable while controls auto-hide;
- keyboard tab order, Space/Enter activation, Escape, mute, and fullscreen;
- seeking shortcuts are absent;
- autoplay begins muted or leaves an actionable Play control;
- Live returns HLS to hls.js `liveSyncPosition`;
- unsupported controls hide rather than fail;
- rapid HLS/WebRTC mode switching leaves one media element and one connection;
- page visibility and online/offline transitions do not create reconnect storms.

### Verification commands

Run at minimum:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

Also inspect the production build output, browser network panel, and
`npm ls hls.js @vidstack/react` for duplicate or remote-loaded runtimes.

## Live acceptance matrix

Automated media mocks cannot prove real latency or recovery. Before final
cutover, run the same OBS/MediaMTX source through legacy and Vidstack players:

1. fresh HLS ≤2s join;
2. 30-minute wired HLS ≤2s playback;
3. 30-minute Wi-Fi HLS ≤2s playback;
4. pause/resume and Go-live;
5. hidden tab for 30 seconds, then foreground;
6. two-second and ten-second network interruption;
7. 1% loss plus 30 ms jitter, then 3% loss;
8. codec failure followed by compatibility HLS;
9. WebRTC join, one forced reader failure, repair, then forced Smooth fallback;
10. desktop Chromium/Firefox and Android Chrome; Safari/WebKit for native HLS
    capability and fallback behavior.

For HLS ≤2s, compare:

- join-to-first-frame time;
- p50, p95, and maximum hls.js latency;
- p50, p95, and maximum forward buffer;
- stall count and total stalled time;
- corrective seek and provider recreation count;
- fallback count;
- glass-to-glass latency from a source clock.

Accept Vidstack only if it stays within the same two-second viewer SLO and does
not materially worsen first frame, stall time, or fallback rate. Any observed
over-two-second healthy sample blocks cutover until it is explained and fixed;
do not widen the SLO to make the migration pass.

## Bundle and performance budget

Vidstack currently advertises about 54 kB gzip for its core feature/component
set, but the actual tree-shaken Next.js client chunk is the only relevant
measurement for this application.

Requirements:

- load Vidstack only on watch/player routes;
- import headless controls directly and omit unused layouts/providers;
- retain one hls.js copy;
- make no player-library CDN requests;
- record the gzip/Brotli increase in the implementation handoff;
- investigate any watch-route increase above 100 kB gzip before acceptance;
- show no measurable regression on directory, account, admin, or statistics
  routes.

Startup performance matters more than a small bundle reduction. Keep eager
loading for an active live channel; do not delay provider loading until idle or
user interaction merely to improve a synthetic page-load score.

## Security and privacy review

Before cutover, verify:

- HLS requests remain same-origin and include only the browser session needed
  by Caddy's authorization boundary;
- Vidstack receives no stream key, internal secret, or raw MediaMTX private
  address;
- the library and CSS are bundled locally with the application;
- support data remains redacted;
- overlays and controls cannot navigate to an untrusted media URL;
- remote-playback controls remain absent;
- no analytics, telemetry, or external poster fetch is added by default;
- mode changes close old hls.js instances, readers, peer connections, timers,
  and MediaStreams.

## Rollout and rollback

Use the temporary server-side implementation selector for the first production
release:

1. deploy code containing both implementations with `legacy` active;
2. verify production health and finish the Vidstack staging/live-source matrix;
3. activate `vidstack` globally during a scheduled test window and recreate
   only the viewer service;
4. monitor player exit reasons, recovery counts, support snapshots, service
   health, and real glass-to-glass tests;
5. on regression, restore `legacy` and recreate the viewer service;
6. do not change MediaMTX, OBS, stream keys, or the auth database during UI
   rollback.

Immediate rollback triggers:

- HLS ≤2s exceeds its healthy latency/buffer SLO;
- native HLS or compatibility fallback disappears;
- WebRTC repair/fallback leaks or fails;
- autoplay leaves no usable control;
- authentication or media requests change behavior;
- controls cannot be operated by keyboard or touch;
- recurring hydration, provider, or browser console errors;
- meaningful increase in stalls, first-frame time, or unsupported playback.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| React-19 support is only on Vidstack's npm `next` tag | Pin the exact tested 1.x version; do not use `latest`; stop if the compatibility spike fails |
| Vidstack defaults change live loading or edge behavior | Set eager load, stream type, live-edge tolerance, provider config, and controls explicitly |
| Vidstack and application both own hls.js teardown | Let Vidstack own lifecycle; use documented provider recreation and direct instance calls only for policy operations |
| High-frequency state causes React render churn | Keep 250 ms SLO samples in refs/direct subscriptions and publish UI diagnostics at one second |
| MediaStream source replacement breaks make-before-break | Prove it in the spike and retain the old reader until the new provider renders a frame |
| Default layout exposes seek/rate/cast controls | Use a minimal custom headless layout |
| UI refactor hides transport error meaning | Keep controller-owned typed status overlays |
| Bundle grows across every page | Route-split player imports and inspect production chunks |
| Mocks hide provider lifecycle bugs | Run real-package component tests plus real browser/live-stream acceptance |
| Quick rollback still downloads both players | Split legacy and Vidstack implementations into separate dynamic chunks and remove legacy after the observation window |

## Definition of done

The refactor is complete when all of the following are true:

- a React-19-compatible Vidstack version is pinned exactly and documented;
- HLS and WebRTC render through one shared Vidstack frame/control design;
- no native `controls` attribute remains in production player components;
- no hls.js or player code is loaded from a CDN;
- all four modes, fallbacks, overlays, diagnostics, and session preferences pass
  parity tests;
- HLS ≤2s preserves its exact configuration and passes automated and live SLO
  acceptance;
- WebRTC repair and Smooth fallback pass live failure tests;
- desktop Chromium, Firefox, WebKit, Pixel-size Chromium, and the supported real
  device matrix pass;
- accessibility and 320 px layout checks pass;
- build, lint, typecheck, unit, integration, and end-to-end tests pass;
- bundle impact is measured and accepted;
- production cutover completes with a tested rollback;
- the legacy player and temporary selector are removed after the observation
  window;
- implementation documentation and support troubleshooting describe Vidstack
  without claiming it provides the two-second latency guarantee.

## References

- Vidstack introduction and feature set:
  <https://vidstack.io/docs/player/>
- Vidstack React installation:
  <https://vidstack.io/docs/player/getting-started/installation/react/>
- Vidstack loading strategies and provider lifecycle:
  <https://vidstack.io/docs/player/core-concepts/loading/>
- Vidstack HLS provider configuration and hls.js instance access:
  <https://vidstack.io/docs/player/api/providers/hls/>
- Vidstack video provider and `MediaStream` object sources:
  <https://vidstack.io/docs/player/api/providers/video/>
- Vidstack live-edge behavior:
  <https://vidstack.io/docs/player/api/live/>
- Vidstack accessibility guidance:
  <https://vidstack.io/docs/player/getting-started/accessibility/>
- hls.js live and buffer API:
  <https://github.com/video-dev/hls.js/blob/master/docs/API.md>
