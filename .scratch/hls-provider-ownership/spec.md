# Deepen HLS provider ownership

Status: resolved

Architecture candidate 02. All six design decisions and the completed
specification are confirmed. The user requested implementation tickets.
Both implementation tickets are resolved.

## Intended result

One application HLS module coordinates an attached provider. `HlsPlayer` renders
the player without combining separate provider callbacks or handling hls.js
events. Provider replacement, application recovery, and diagnostics have one
owner. Existing playback behavior remains intact.

## Current behavior

`components/vidstack-player.tsx` supplies the video element, provider kind, and
hls.js instance through separate callbacks. Vidstack owns instance creation,
media attachment, source loading, and destruction.

`components/hls-player.tsx` combines those values with HLS configuration,
recovery, native HLS behavior, diagnostics, and rendering. Its media-error
handler depends on Vidstack having attempted recovery first. The current HLS
component tests replace Vidstack with a test implementation. The existing browser
test runs real Vidstack and hls.js, checks that one fatal media error causes one
recovery and one media detach, and verifies that playback resumes.

`lib/playback-run.ts` owns shared playback state, progress checks, Viewing access
checks, and recovery eligibility. `components/use-playback-run.ts` connects those
rules to browser state and intentional pauses. `components/use-playback-mode.ts`
owns Playback mode selection and fallback. The Streaming contract remains the
authoritative source for timing and fallback values.

## Accepted decisions

### Q1: Preserve playback behavior

Improve HLS ownership and verification while preserving Playback modes, timing,
fallback rules, and viewer controls. Keep recovery eligibility in `PlaybackRun`
and Playback mode selection in `usePlaybackMode`. This work does not change the
Streaming contract or introduce product behavior changes.

### Q2: Retain Vidstack instance ownership

Vidstack continues to create and destroy hls.js instances. Application HLS
handling belongs behind one small interface that manages provider changes and
recovery coordination. Replacing Vidstack would expand the approved scope.

### Q3: Application HLS module

One HLS module owns application subscriptions, timers, transport
actions, contract configuration, diagnostics, and source or retry requests for
both hls.js and native HLS. `HlsPlayer` renders controls, messages, and statistics
from that interface. It does not coordinate raw hls.js events. The module reports
unavailable or unstable playback to the existing Playback mode owner.

### Q4: Attachment and state lifetime

Treat the provider kind, video element, and optional hls.js instance as
one attachment. Application handling starts only when that attachment is ready.
Replacement retires its listeners, timers, and pending work. Events from the old
attachment cannot change the new attachment's state. Playlist observations belong
to the current instance. Preserve existing retry-history, instability-history,
and intentional-pause behavior across replacements.

### Q5: Built-in recovery order

Preserve Vidstack's built-in recovery behavior and hide its ordering
dependency inside the HLS integration. A fatal media error must not cause a second
application call to `recoverMediaError`. Vidstack can attempt recovery before the
application checks pause, visibility, or connectivity. Changing that built-in
behavior is separate work. Application recovery must still obey `PlaybackRun`.

### Q6: Verification scope

Use focused HLS, Vidstack, Playback run, and Playback mode tests, the
fast suite, lint, typecheck, and build. Run the existing real-provider recovery
and paused-frame browser checks in a focused desktop Chromium run. These browser
checks start Docker-backed fixtures. Exclude the full Docker suite and full
browser suite. Stop and report a focused browser run that exceeds ten minutes.
Native Safari playback requires separate device evidence.

## Module interface and ownership

The HLS module accepts the current Channel playback inputs, selected HLS Playback
mode, and existing unavailable or unstable callbacks. It supplies the provider
configuration and attachment wiring, visible playback state, diagnostics, the
video reference for statistics, and actions for retry, compatibility-stream
selection, and intentional pause or play.

`HlsPlayer` can pass the provider wiring to `VidstackPlayer`. It must not combine
provider kind, video, and instance state, issue hls.js transport calls, or depend
on error-listener order. A hook or private helpers may implement the module. The
design does not require a new provider framework or a shared transport interface.

| Owner | Responsibility |
| --- | --- |
| Vidstack provider | Create, attach, load, and destroy hls.js instances. Perform existing built-in media recovery. |
| Application HLS module | Coordinate complete attachments, HLS configuration, native HLS behavior, subscriptions, timers, transport actions, diagnostics, retry requests, and compatibility-stream selection. |
| `PlaybackRun` and `usePlaybackRun` | Own shared playback state, progress checks, Viewing access checks, recovery eligibility, and pending recovery work. |
| `usePlaybackMode` | Select Playback modes and apply existing unavailable or unstable fallback rules. |
| `HlsPlayer`, `VidstackPlayer`, and `PlaybackStats` | Render controls, overlays, labels, and statistics. Preserve shared audio and theater behavior. |

The HLS integration can contain raw provider objects internally. Application
rendering must not use those objects to coordinate playback. Preserve the
existing video-element integration used by `WebRtcPlayer` when changing shared
Vidstack wiring.

## Required behavior and verification

Tests exercise the module interface used by production. Move relevant behavioral
tests with their owner. Keep focused rendering and shared-player tests, and retain
the real-provider browser regression because a mocked provider cannot prove error
listener order.

| Scenario | Required result |
| --- | --- |
| hls.js provider is announced before its instance is ready | Do not start application handling with an incomplete or mixed attachment. |
| Provider replacement or unmount | Remove application subscriptions and timers, cancel old pending work, and ignore late callbacks. Vidstack remains the instance destruction owner. |
| Playback mode change or retry replaces the instance | Use the new instance's playlist observations. Preserve existing retry and instability history according to its current lifetime. |
| Explicit pause, then provider replacement | Keep the viewer paused and hls.js loading stopped. An involuntary media pause must still permit eligible recovery. |
| Hidden page, offline browser, or non-live Channel | Preserve existing application recovery eligibility and resume behavior. |
| Fatal media error | Preserve Vidstack's recovery and avoid a duplicate application recovery. Repeated errors retain the existing retry behavior. |
| Confirmed access denial | Stop application media work and prevent later application recovery. Stale checks cannot alter the current run. |
| Playback resumes before a retry or access check finishes | Cancel obsolete recovery work. |
| hls.js and native HLS are both available | Preserve the existing preference for hls.js. |
| Only native HLS is available | Preserve Balanced and Smooth behavior. Ultra-low remains unavailable. |
| Ultra-low timing or buffer limits are exceeded | Preserve contract-based correction, adaptive observations, diagnostics, and fallback notifications. |
| Compatibility stream or manual retry is selected | Preserve current source selection and replacement behavior through the HLS module's actions. |
| WebRTC uses the shared Vidstack player | Preserve its video attachment, controls, audio preferences, and intentional-pause reporting. |

Run the two accepted browser checks with desktop Chromium, no retries, and one
worker. The ten-minute limit includes fixture startup for that browser run.
Report failure or timeout with the captured output. Do not expand the run into
the full browser or Docker suite. A skipped or timed-out browser check is not
evidence that real-provider recovery passed.

## Files involved

- `components/hls-player.tsx` and its tests: move application coordination behind
  the HLS module interface and keep rendering behavior intact.
- A focused HLS module beside the player: own the accepted application behavior.
  Its exact file organization is an implementation detail.
- `components/vidstack-player.tsx` and its tests: provide complete attachment
  wiring while preserving shared controls and the WebRTC video callback.
- `components/live-player.tsx`, `components/webrtc-player.tsx`, and
  `components/playback-stats.tsx`: verify existing callers and diagnostics.
- `lib/playback-run.ts`, `components/use-playback-run.ts`, and
  `components/use-playback-mode.ts`: retain their responsibilities and behavioral
  checks. Change an integration only if the new HLS interface requires it.
- `tests/e2e/player.spec.ts`: retain the real-provider recovery and paused-frame
  checks.
- `README.md`: update the maintained playback ownership description after
  implementation.

## Outside scope

- New Playback modes, latency targets, recovery policy, or viewer controls.
- Replacing Vidstack, overriding its built-in recovery, or upgrading dependencies.
- Moving shared recovery eligibility or cross-protocol selection into HLS.
- Changes to the Streaming contract, media server, conversion workers, or OBS.
- A general provider framework or parallel copies of playlist timing state.
- A release, deployment, or claim of verified native Safari playback.
- The full Docker suite and full browser suite.

## Documentation

This file records proposed and accepted design decisions. The repository uses
`CONTEXT.md` for domain terms. General library and implementation terms do not
belong in that glossary. Accepted operational rules belong in the maintained
guide when the implementation changes. A separate ADR is unnecessary unless a
decision meets the domain-modeling skill's criteria.

## References

- [Domain language](../../CONTEXT.md).
- [Playback run and recovery](../../README.md#playback-run-and-recovery).
- [Streaming contract](../../config/streaming-contract.v1.json).
- [HLS player](../../components/hls-player.tsx).
- [Vidstack player](../../components/vidstack-player.tsx).
- [Player browser regressions](../../tests/e2e/player.spec.ts).
- [Verification guide](../../docs/verification.md).

## Comments

- 2026-10-18: The user selected candidate 02, "Deepen HLS provider ownership",
  for a grill-with-docs interview. Code inspection is read-only. No tests or
  Docker workloads were started. Preserve the user's limit against another
  full Docker suite when planning verification.
- 2026-10-18: The user answered "yes to both" for Q1 and Q2. Preserve playback
  behavior and keep Vidstack responsible for hls.js instance creation and
  destruction. Q3 through Q6 remain proposals.
- 2026-10-18: The user answered "yes to all" for Q3 through Q6. Accepted one
  application HLS module, complete attachment lifetime handling, preserved
  Vidstack recovery order, and focused verification with a ten-minute browser
  limit. All six decisions are accepted. The specification is ready for final
  shared-understanding confirmation. No implementation or test execution has
  started.
- 2026-10-18: The user confirmed the completed specification and requested ticket
  creation. The work is split into two tickets: complete provider attachment and
  replacement first, then centralize application HLS coordination. Ticket 02
  depends on ticket 01. Each ticket includes its own behavioral verification.

- 2026-10-18: Ticket 01 is resolved. The running HLS player consumes complete attachments, retires old application work synchronously, and ignores late callbacks. All 776 non-Docker tests and the two focused browser regressions pass, with zero findings in both reviews. Ticket 02 remains ready for implementation. Native Safari verification is separate.

- 2026-10-18: Ticket 02 is resolved. `useHlsPlayback` owns application HLS
  coordination behind one interface, and `HlsPlayer` renders its output. The
  existing behavior tests moved with their owner. All 782 non-Docker tests,
  both focused browser checks, lint, typecheck, and build pass. Standards and
  Spec reviews each report zero findings. The full Docker and browser suites
  were excluded, and native Safari remains unverified.
