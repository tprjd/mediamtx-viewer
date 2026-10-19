# 01: Coordinate complete HLS provider attachments

**What to build:** When a viewer starts HLS playback, changes Playback mode, or
retries playback, the player uses one complete provider attachment. A delayed
callback from the previous provider cannot replace the current video or instance.
Intentional pauses, native HLS playback, and shared WebRTC controls keep working.

**Blocked by:** None (can start immediately).

**Status:** resolved

Spec: [Deepen HLS provider ownership](../spec.md).

This is the first complete implementation slice. Connect the new attachment
representation to the running player and verify replacement behavior. The wider
move of application HLS coordination belongs to ticket 02.

## Acceptance criteria

- [x] Represent the provider kind, video element, and optional hls.js instance as one attachment. Application HLS handling starts only when that attachment is complete. A native HLS attachment does not require an hls.js instance.
- [x] Replace the HLS caller's separate provider-state coordination with the complete attachment interface. Do not combine a new provider's video with an old provider's instance, including while instance creation is pending.
- [x] Configure the bundled hls.js provider before its instance starts. Vidstack continues to own instance creation, media attachment, source loading, destruction, and built-in media recovery.
- [x] On provider replacement or unmount, unsubscribe from the retired provider and clean up application listeners, timers, and pending work. Ignore late instance callbacks and events from the retired attachment. Do not destroy a Vidstack-owned instance from application cleanup.
- [x] Keep a replacement hls.js provider stopped when the viewer intentionally paused playback. Preserve eligible recovery after an involuntary media pause. Reset instance-specific playlist observations without changing existing retry or instability history lifetimes.
- [x] Preserve hls.js preference when both engines work, native HLS support for Balanced and Smooth, and the hls.js requirement for Ultra-low. Preserve shared WebRTC video attachment, audio preferences, controls, and intentional-pause reporting.
- [x] Tests exercise production attachment wiring through initial attachment, delayed instance creation, native attachment, replacement, unmount, and a late callback from the previous provider. Verify that retired work cannot change the current playback state.
- [x] Preserve the existing real-provider recovery and paused-frame browser checks. One fatal media error causes one recovery and one detach, then playback resumes. Advancing the live edge does not move an intentionally paused frame.
- [x] Update the maintained playback ownership description to describe the attachment interface actually delivered by this ticket.
- [x] Run focused HLS and shared-player tests, relevant Playback run and Playback mode tests, the non-Docker fast suite, lint, typecheck, and build. Run only the two accepted browser checks in desktop Chromium with one worker and no retries. Stop and report if the focused browser run, including fixture startup, exceeds ten minutes. Exclude the full Docker and browser suites.
- [x] Report failed, skipped, or timed-out checks accurately. Browser fixtures use Docker, and native Safari remains a separate device check. Follow the repository delivery workflow for the verified task changes.

## Comments

- 2026-10-18: Created after the user confirmed the design and requested tickets.
  This ticket prepares the attachment interface used by ticket 02 and is
  independently verifiable in the current player. It does not change the
  Streaming contract, playback policy, or dependencies.

- 2026-10-18: Implementation started. The agreed test interfaces are production provider attachment wiring and the HLS player, with the two existing real-provider browser checks. The full Docker and browser suites remain excluded.

- 2026-10-18: Implemented complete provider attachments and synchronous retirement of application work. Added failing regressions before the fixes for delayed attachment reporting and queued playlist events after replacement, unmount, or provider notification before React commits. Preserved Vidstack instance ownership and the WebRTC video callback.
- 2026-10-18: Verification passed: 121 focused tests; all 776 non-Docker tests in 80 files, 37.86 seconds; lint; typecheck; production build; and both accepted real-provider browser checks, 36.42 seconds including fixture startup. Standards and Spec reviews each reported zero findings. Browser fixture containers were removed by teardown. The full Docker and browser suites were excluded. Native Safari remains unverified.
- 2026-10-18: Delivered in `82a6290` (`fix(player): coordinate complete HLS provider attachments`) and pushed to `origin/main`. Remote HEAD matches the local commit. The five task files were committed; pre-existing workspace changes remain separate.
