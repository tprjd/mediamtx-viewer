# 06: Recover from short upload interruptions

**What to build:** A viewer watching a WHIP-published Channel survives a
two-second upload interruption without refreshing the page. Once sufficient
upload capacity returns, playback resumes and delay falls below one second
within five seconds, without reconnect loops or unexpected playback.

**Blocked by:** 03: Verify 1080p60 through the real viewer (resolved).

**Status:** ready-for-agent

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
- [ ] Keep transport actions in their adapters, shared Playback run eligibility
  in its controller, and cross-protocol decisions in Playback mode selection.
  Preserve the existing terminal-failure fallback behavior.
- [ ] Respect pause, hidden-tab, offline, access-loss, and unmount behavior.
  Stale callbacks and replaced readers cannot restart playback or keep media
  running after access is denied.
- [ ] Represent the accepted WebRTC targets in the authoritative streaming
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
