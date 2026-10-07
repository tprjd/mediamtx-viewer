# 06: Recover from short upload interruptions

**What to build:** A viewer watching a WHIP-published Channel survives a
two-second upload interruption without refreshing the page. Once sufficient
upload capacity returns, playback resumes and delay falls below one second
within five seconds, without reconnect loops or unexpected playback.

**Blocked by:** 03: Verify 1080p60 through the real viewer (resolved).

**Status:** needs-info

Type: task
Spec: [Managed OBS WHIP streaming](../spec.md)

- [ ] Reproduce the two-second upload outage through the actual application viewer
  at 1080p60 with sound. Measure recovery before changing timers or connection
  behavior; the user-reported baseline does not establish outage results.
- [ ] For a visible, unpaused viewer, restore playback and sub-second delay within
  five seconds after sufficient network capacity returns. Repeat at different
  keyframe positions. Save failed trials as well as successful trials.
- [ ] Allow the current WebRTC connection to recover first and use bounded reader
  recovery when necessary. A short outage must not cause premature HLS fallback,
  repeated reconnects, or permanently delayed playback.
- [x] Keep transport actions in their adapters, shared Playback run eligibility
  in its controller, and cross-protocol decisions in Playback mode selection.
  Preserve the existing terminal-failure fallback behavior.
- [ ] Respect pause, hidden-tab, offline, access-loss, and unmount behavior.
  Stale callbacks and replaced readers cannot restart playback or keep media
  running after access is denied.
- [x] Represent the accepted WebRTC targets in the authoritative streaming
  contract and its validation. Preserve HLS timing and the 60-second retry cooldown.
- [ ] Record freezes, reconnects, audio continuity, and time to return below one
  second. Physical source-to-screen measurements establish latency; browser frame
  age and mocked watchdog tests supply supporting evidence only.
- [ ] Exercise sustained upload below the selected bitrate and document the
  expected limitation. Do not claim automatic bitrate adaptation or change the
  1080p60 requirement to make the short-outage test pass.
- [ ] Reuse the existing watchdog, Playback run, and Playback mode regression tests
  for cancellation and recovery edge cases. Verify observable playback through
  the real viewer instead of asserting only internal timer calls.

## Independent verification

Use the established WHIP publishing path with WebRTC selected. New Managed OBS
profile generation and AAC HLS conversion are not required to verify recovery
within WebRTC. Audible fallback after terminal failure belongs to ticket 04;
the complete generated-profile flow is rerun in ticket 07.

## Comments

HLS playback after a short outage does not satisfy the sub-second recovery
requirement. It is the separate fallback for failed WebRTC recovery.

2026-10-07: Approved with ticket 03 as its only blocker, now resolved by
the user's test report. Removed the unnecessary dependency on ticket 04.
Ticket 05 owns initial Playback mode selection; this ticket owns outage recovery.


2026-10-07 implementation evidence:

- Fixed a premature fallback during reader replacement. An old reader's delayed
  missing-audio check could switch to HLS while the new reader negotiated.
  A failing component regression reproduced that behavior. The check now ignores
  replaced readers, and the regression passes.
- Retained the existing five-sample stall detection, one reader replacement,
  terminal HLS fallback, and 60-second stable-progress reset. No timing changes
  were justified by the available measurements.
- Added supporting component coverage for two-second frame stalls at three
  sample offsets. The current reader survives and the WebRTC indication remains.
  These controlled frame counters do not measure network or physical delay.
- Streaming contract 1.1.0 records an exclusive 1,000 ms latency ceiling, a
  2,000 ms upload interruption, and a 5,000 ms recovery deadline measured after
  sufficient capacity returns. Recovery includes both resumed playback and delay
  below the ceiling. These are acceptance targets, not browser timer settings.
- HLS timing, managed keyframes, and the manual WebRTC retry cooldown are unchanged.
- Focused checks passed: WebRTC player, Playback run, streaming contract, and
  deployment contract validation. Type checking and changed-file lint passed.

Remaining acceptance evidence:

The integration run must measure actual 1080p60 publishing through the application
viewer before this ticket resolves. Reuse the prototype's generated media and
network gateway, but attach its browser measurements to the authenticated Channel
page. Do not replace the application player with the prototype's bare reader.
Preserve failed trials, decode freezes, reader counts, audio observations, and
recovery time at different keyframe positions. Browser frame age remains
supporting evidence. Windows OBS and physical iPhone glass-to-glass measurements
are still required. The user's earlier passing test did not provide encoder,
bitrate, or outage measurements. Sustained insufficient-upload behavior also
remains part of that run. The integration agent owns this measurement pass.


2026-10-07 integration update: Code and review fixes are committed on
`codex/whip-streaming`. See [validation](../validation.md) and the
[application evidence](../application-evidence.json) for executed checks and
limitations. The actual application passed local 1080p60 packet-drop recovery,
HLS fallback with retained sound settings, manual WebRTC return, stable viewer
counting, and RTMP rollback. Tests use generated media on this Mac, not the final
Windows profile or physical iPhone. The ticket remains `needs-info` for its
unverified acceptance items; no pilot rollout or production deployment is claimed.
