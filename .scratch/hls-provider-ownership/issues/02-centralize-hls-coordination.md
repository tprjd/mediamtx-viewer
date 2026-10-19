# 02: Centralize application HLS coordination

**What to build:** HLS playback, recovery, compatibility-stream selection, and
diagnostics operate through one application HLS module for both hls.js and native
HLS. Viewers keep the same Playback modes and controls. Rendering no longer needs
to coordinate provider events or understand media-error listener order.

**Blocked by:** 01: Coordinate complete HLS provider attachments.

**Status:** resolved

Spec: [Deepen HLS provider ownership](../spec.md).

Use the complete attachment delivered by ticket 01. This ticket moves application
coordination and its behavioral tests together, then verifies the running player
through the new interface. It is not a second provider implementation.

## Acceptance criteria

- [x] One application HLS module owns contract-derived configuration, application subscriptions and timers, transport actions, native HLS observations, diagnostics, retry requests, and compatibility-stream selection. Both HLS engines use the same application-facing interface.
- [x] The interface accepts current Channel playback inputs, the selected HLS Playback mode, and existing unavailable or unstable callbacks. It supplies provider wiring, visible playback state, diagnostics, the video reference for statistics, and existing user actions. Rendering does not issue hls.js calls, combine attachment state, or depend on provider error-listener order.
- [x] Keep Vidstack responsible for instance creation, loading, destruction, and built-in recovery. Hide its media-error ordering dependency inside the HLS integration. Do not call media recovery a second time for the same fatal event. Preserve the current behavior for repeated errors.
- [x] Keep shared state, progress checks, Viewing access checks, recovery eligibility, and pending recovery work in Playback run. Keep Playback mode selection and fallback in the existing mode owner. Report unavailable or unstable playback through the existing callbacks.
- [x] Preserve recovery behavior while paused, hidden, offline, or no longer live. Confirmed access denial stops application media work and blocks later application recovery. Resumed playback cancels obsolete retries and access checks. Events and results from a retired attachment cannot affect its replacement.
- [x] Preserve current backoff, retry history, instability history, and deliberate pause behavior across replacements. Read playlist timing from the current instance and discard old observations when that instance changes.
- [x] Preserve native HLS latency correction and capability reporting, hls.js preference, Ultra-low contract limits and adaptive observations, and existing fallback notifications. Do not change the Streaming contract or introduce new playback policy.
- [x] Keep manual retry, compatibility-stream selection, source replacement, overlays, mode labels, diagnostics, shared audio preferences, and theater controls working through the new interface. Preserve WebRTC use of the shared player.
- [x] Move relevant behavioral tests to the production HLS module interface. Cover supported engines, replacement cleanup, stale callbacks, pause, access denial, cancelled retries, native correction, and Ultra-low limits. Retain focused rendering and shared-player tests without maintaining a second copy of coordination logic in tests.
- [x] Keep the real Vidstack and hls.js browser test for one recovery and one detach followed by resumed playback. Keep the browser test that holds the paused frame as the live edge advances. A mocked provider alone does not verify listener order.
- [x] Remove superseded HLS coordination and unused exports or callbacks once all callers use the new interface. Do not introduce a general provider framework, duplicate playlist timing state, dependency upgrades, or unrelated playback changes. Update the maintained playback ownership description to match the completed implementation.
- [x] Run focused HLS, shared-player, Playback run, and Playback mode tests, the non-Docker fast suite, lint, typecheck, and build. Run only the two accepted browser checks in desktop Chromium with one worker and no retries. Stop and report if the focused browser run, including fixture startup, exceeds ten minutes. Exclude the full Docker and browser suites.
- [x] Report failed, skipped, or timed-out checks accurately. Browser fixtures use Docker, and native Safari remains a separate device check. Follow the repository delivery workflow for the verified task changes.

## Comments

- 2026-10-18: Created after the user confirmed the design and requested tickets.
  Ticket 01 is the only blocker because it supplies the complete attachment
  interface. Vidstack's built-in recovery can still run before application
  eligibility checks; changing that behavior is outside this refactor.

- 2026-10-18: Implementation started after ticket 01 was delivered. Behavioral tests will move to the production HLS module interface. The full Docker and browser suites remain excluded; the two accepted browser checks retain the ten-minute limit.

- 2026-10-18: Implemented `components/use-hls-playback.ts` as the application HLS
  owner. The existing coordination body moved unchanged; `HlsPlayer` now renders
  the returned state, diagnostics, provider wiring, and user actions. Capability
  detection moved with its owner, and the maintained README describes the boundary.
- 2026-10-18: Moved all 51 existing HLS behavior tests to the production hook
  interface. Added three cases for compatibility selection and retry, repeated
  fatal media errors, and the Channel going offline. Kept three focused rendering
  tests and all shared-player and browser regressions. One new rendering test
  initially timed out while comparing a video reference as a nested object;
  identity assertions corrected the test, and all final checks pass.
- 2026-10-18: Verification passed: 141 focused playback tests; 782 non-Docker
  tests across 81 files in 31.70 seconds; lint; typecheck; production webpack
  build; and both accepted desktop Chromium checks with one worker and no retries.
  The browser run, including fixture startup, completed in 31.0 seconds. It
  verified one real-provider recovery and detach, resumed Smooth playback,
  and a stable paused frame followed by resumed playback. Logs are saved in
  `/tmp/hls-coordination-fast-tests.log`, `/tmp/hls-coordination-lint.log`,
  `/tmp/hls-coordination-build.log`, and `/tmp/hls-coordination-browser.log`.
  The browser fixture logged its existing Chat retention `CLEANUP_FAILED`
  message; both selected playback checks passed. No Docker containers remained
  running after fixture cleanup. The full Docker and browser suites were excluded;
  native Safari remains a separate device check.
- 2026-10-18: Code review against `82a6290a1a0757f705982a1bec37bc5b04fe434d`
  reported zero Standards findings and zero Spec findings. Both reviewers
  independently confirmed the preserved coordination body and ownership boundary.
- 2026-10-18: Delivered in commit `a134148` (`refactor(player): centralize HLS
  playback coordination`) and pushed from `codex/whip-streaming` to its configured
  upstream, `origin/main`. Only the seven task files were committed. The existing
  `next-env.d.ts` change and local planning directories were excluded.
