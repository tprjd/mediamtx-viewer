# 07: Validate the complete pilot and rollback

**What to build:** Demonstrate that the generated Windows OBS profile, actual
OCI deployment, application viewer, and physical iPhone 13 work together under
normal playback, interruptions, and fallback. Keep the feature limited to the
pilot Channel until evidence supports a separate expansion decision.

**Blocked by:** 04: Fall back to HLS with sound; 05: Create and use the separate
OBS profile; 06: Recover from short upload interruptions.

**Status:** ready-for-agent

Type: task
Spec: [Managed OBS WHIP streaming](../spec.md)

- [ ] Use the generated profile on the actual Windows host and a physical iPhone
  13 on current iOS. Record exact software versions, encoder settings, bitrate,
  keyframes, network conditions, and actual OCI allocation.
- [ ] Verify 1080p60 with sound and healthy camera-to-screen delay below one second.
  Preserve complete measurements, including median, high-percentile, and worst
  observed delay. Do not substitute the earlier Mac 720p experiment.
- [ ] Repeat two-second upload outages at different keyframe positions. Playback
  and sub-second delay return within five seconds after restoration, without
  refreshing the page or treating HLS fallback as a successful low-latency recovery.
- [ ] Force WebRTC failure while the source remains live. Verify automatic smooth
  HLS with synchronized sound, correct mode indication, no retry loop, and manual
  WebRTC selection after the cooldown.
- [ ] Verify explicit Playback mode preferences, pause, background and foreground
  transitions, viewer access loss, and stable Viewer identity across transports.
  The converter is not counted as a viewer and emits no duplicate live event.
- [ ] Verify setup reruns, repair, stream-key rotation, both publishing profiles,
  worker crash, Publisher restart, MediaMTX restart, and Channel disablement.
  Derivative media cannot outlive its authorized source.
- [ ] Exercise sustained insufficient upload and blocked UDP with the configured
  TCP ICE route. Distinguish failed WHIP publishing from failed viewer playback.
  Record any unsupported network case without claiming HLS can repair upload.
- [ ] Measure CPU, memory, errors, audio synchronization, and egress on the actual
  OCI VM with existing services plus WebRTC and HLS viewers. Verify current free
  allowances and confirm that all server video remains copied.
- [ ] Demonstrate rollback to the retained RTMP profile and existing HLS playback.
  Disable pilot worker activity without altering unrelated Channels or credentials.
- [ ] Run lint, type checking, applicable unit and integration tests, streaming
  contract validation, build, and relevant browser tests. Record their results.
- [ ] Update the maintained Windows setup and Oracle deployment guides with the
  implemented behavior. Save pilot evidence and a clear pass or fail conclusion.
- [ ] Keep wider availability disabled until a separate expansion decision.
  Missing physical-device or actual-VM evidence remains outstanding.

## Independent verification

This ticket exercises the integrated result of tickets 04, 05, and 06. The user's
completion report for ticket 03 does not establish that these later changes pass.
A successful rollback and explicit evidence are required before expansion.

## Comments

Expansion to other Channel owners is a separate rollout decision. Missing
physical-device evidence is an incomplete pilot, not an assumed pass. Exercise
rollback to RTMP and HLS before declaring the pilot ready for wider use.

2026-10-07: Approved as the final integration and rollout-validation slice.
Blocked only by tickets 04, 05, and 06; ticket 03 is already covered transitively.
This ticket does not authorize wider rollout by itself.
