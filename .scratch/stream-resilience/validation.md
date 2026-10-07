# WHIP implementation validation

The code is implemented on `codex/whip-streaming`. The pilot is not accepted for
rollout. Windows OBS, the physical iPhone 13, and the deployed OCI stack still
need the complete acceptance run in ticket 07. No production configuration was
changed and no release was cut.

## Local evidence

[Application evidence](application-evidence.json) records the production-build
check on 2026-10-07. Native macOS FFmpeg sent one H.264/Opus stream through
MediaMTX 1.20.1 to the authenticated application Channel page in Chromium.
The video was configured for 1080p60 with no B-frames, two-second keyframes, and
a 10 Mbps maximum bitrate. These are test settings, not measurements from the
user's earlier Windows test. The generated Managed OBS profile still uses a
provisional 10 Mbps default.

A timestamp encoded inside each generated picture measured its age in the
application video. The healthy sample median was 31 ms and its maximum was
43 ms. This excludes camera capture and physical display scanout. It is not a
physical camera-to-screen result.

Three upload packet drops lasted 2.127, 2.312, and 2.125 seconds. The first
observed picture less than one second old arrived 785, 512, and 258 ms after
restoration. The viewer connection bypassed the publisher's network gateway.
The application stayed on WebRTC, its frame counter did not reset, and received
audio energy increased. Exact encoder keyframe phase was not recorded.

The initial fallback run exposed a defect: switching from unmuted WebRTC to HLS
reset the player to muted. That run is retained as failed audio evidence.
HLS video stayed in Smooth mode for 64 seconds, kept one Viewer identity, and
allowed manual WebRTC return after the cooldown. The repeat on commit `0f5d0e5` used the actual production worker image.
HLS stayed unmuted and playing for 64 seconds. Audio RMS was about 0.063 after
the analyser started, and the manual WebRTC return passed. The source continued
publishing throughout the forced viewer failure. A separate repeat with default
Chromium autoplay rules also retained sound without a second unmute click.
Killing the production converter process started a new process and restored the
derivative in 2.143 seconds; the canonical Publisher stayed ready with the same
source identifier.

A local switch from WHIP to RTMP removed the derivative and converter activity.
The application played canonical H.264/AAC through Balanced HLS at 1920×1080.
After the initial unmute action, measured audio RMS was 0.063 and the Channel
counted one viewer. This validates the application route, not publishing from
both retained Windows OBS profiles.

MediaMTX logged LL-HLS part-duration changes after upload packet drops. The log
warns about iOS clients. Keep native iPhone HLS playback after interruptions in
the acceptance run; Chromium playback does not close that requirement.

Local raw results, scripts, and screenshots are in `.data/whip-integration/`.
They use an isolated test database and generated media. Runtime environment files and generated test credentials remain local and are
not committed.

## Required completion run

1. Deploy a verified release through the existing managed deployment process.
   Set one pilot Channel slug and a separate HLS worker secret. Add the private
   derivative path rule from the maintained MediaMTX example.
2. Run the generated setup on the actual Windows host. Record OBS and Windows
   versions, selected H.264 encoder, bitrate, profile settings, and the retained
   RTMP configuration. Confirm both profiles publish after key rotation and
   repair, without changing the shared scene collection.
3. Use the physical iPhone 13 on current iOS. Record exact iOS version and network
   conditions. Measure camera-to-screen delay with synchronized source and
   display observations. Preserve median, high percentile, and worst values.
4. Repeat two-second upload losses at different measured keyframe positions.
   Both playback and sub-second delay must return within five seconds after
   upload capacity returns. A switch to HLS is not a recovery pass.
5. Force viewer WebRTC failure with the source still live. Confirm Smooth HLS
   with sound, audio/video synchronization, retained volume, stable Viewer
   identity, and manual return after the 60-second cooldown. Include native HLS
   after an upload interruption and access revocation through the deployed proxy.
6. Exercise worker and MediaMTX restarts, Channel disablement, key rotation,
   source replacement, sustained insufficient upload, and blocked UDP with the
   configured TCP ICE route. Preserve failures and limitations.
7. Measure CPU, memory, egress, and audio synchronization on the actual OCI VM
   with existing services and both viewer transports. Verify its actual free
   allocation and current limits. Confirm video is copied throughout the server.
8. Return to the retained RTMP profile, confirm audible HLS, and disable the pilot
   worker configuration. Keep wider availability disabled until a separate
   expansion decision.

## Automated checks

The final implementation passed these local checks with Node 24.15.0:

- 725 fast tests, including executable PowerShell profile maintenance checks.
- Real-media Docker integration using a pinned multi-architecture FFmpeg runtime.
  This includes copied video, AAC output, worker restart, and key rotation while
  the old Publisher deliberately stays connected.
- Four Chromium player tests covering controls, fullscreen, theater mode, and
  pause while the HLS live edge advances.
- ESLint, TypeScript, streaming-contract validation, and the production build.
- Production Compose and proxy configuration validation.
- Build and live operation of the production thumbnailer/media-worker image.

The Linux CI compatibility defects were fixed with an explicit Docker host
mapping and a container-provided FFmpeg runtime. The verification group passed
locally. Hosted verification subsequently passed for the v2.1.2 pilot deployment
recorded below.

## Pilot deployment, 2026-10-07

Release v2.1.2 passed all 19 hosted verification groups, ARM64 image checks,
and publication checks in GitHub Actions run 37663191110. Browser verification
passed with 86 tests and 12 intentional skips. The full browser suite also passed
locally with Linux x64 Chromium. Two browser-test fixes were required: use real
MediaMTX reader types in the viewer fixture, and wait for the initial Chat access
refresh before entering a message. Existing screenshot baselines were retained.

The managed deployment completed with result `active`, phase `complete`, all
seven services running, and its operation lock released. It activated v2.1.2
on the existing Oracle installation.
At 18:38 UTC, direct checks confirmed the public login and header version,
healthy application and Chat status, an empty Chat delivery queue, and both
media-worker supervisors. The private HLS worker endpoint accepted its credential
and rejected an unauthenticated request. No fallback job was active during this
check.

Retention kept the current and previous releases and two verified deployment
backup sets on each machine. Two older image-removal entries remain pending;
the deployment did not force their removal.

The pilot is limited to Channel `live`, owned by `power`. Wider availability
remains disabled. No production Publisher was started for this deployment check.
The physical Windows OBS, iPhone 13, camera-to-screen latency, upload-interruption,
and OCI load acceptance checks above remain pending.

## Standards review

Both findings are resolved. The required media test now provides its runtime and
Linux host mapping. The worker and playback projection share normalized pilot
configuration and source eligibility. The follow-up review found no new issue.

## Spec review

The profile repair defect is resolved: retained WHIP credentials update even when
repair cannot use the H.264 encoder. Additional checks fixed audio control loss
across transport replacement and stopped old-source conversion after key rotation.
The follow-up review found no new code violation. Physical device and OCI
acceptance remain open.

## HLS audio timing and reconnect indicator fix, 2026-10-07

The live Windows WHIP stream had about 877 ms of additional audio delay in the
AAC HLS derivative. The measurement matched identical encoded video frames and
correlated decoded audio from the canonical and derivative HLS tracks. A new
1080p60 flash-and-tone integration test reproduced a 523 ms offset with the old
worker. The previous codec-only probe did not detect this failure.

The worker now reads Opus through enhanced RTMP and publishes copied H.264 plus
AAC through RTMP inside the container network. Both tracks retain a common
presentation timeline. OBS still publishes through WHIP. Worker authorization
remains limited to the active source generation and its private derivative.
Unauthenticated RTMP reading and non-HLS derivative reading remain denied.
The media test uses the same Alpine FFmpeg package as production; the previous
static fixture used librtmp and did not support enhanced RTMP Opus negotiation.

The real-media test now checks flash/tone alignment within 100 ms before and
after a worker restart, key revocation, and a return to RTMP with AAC. The RTMP
case verifies decoded audio/video alignment through canonical HLS and confirms
that no WHIP conversion job remains.

The HLS player no longer treats a network `stalled` event as a playback failure.
Buffered video can continue during that event. A `waiting` event must persist
for 250 ms before the reconnect indicator or Ultra low instability counter
changes. Resume, pause, and disposal cancel the pending indication. Existing
transport recovery and the progress watchdog remain active.

Validation: the timing and player regressions failed before their fixes and
passed afterward. The final focused run passed all 49 tests, including real
WHIP-to-HLS sync after worker restart and RTMP/AAC rollback. The fast suite
passed 726 tests, with one PowerShell test skipped because PowerShell is not
installed. Lint, type checking, and the production build passed.

Release v2.1.3 passed all 19 hosted verification groups and ARM64 image checks
in [release run 37675795105](https://github.com/tprjd/mediamtx-viewer/actions/runs/37675795105).
The first restart-check job stopped during an Ubuntu package download before
the test started. Its retry passed; completed checks were retained.

The managed production update in
[deployment run 37680766308](https://github.com/tprjd/mediamtx-deployment/actions/runs/37680766308)
activated v2.1.3 with result `active` and phase `complete`. At 20:30 UTC, the
public login returned 200, the header and internal health response showed
v2.1.3, and application and Chat health passed. Both media-worker supervisors
were running. The deployed HLS worker had the enhanced RTMP input code and
configuration. The private worker endpoint accepted its credential and rejected
an unauthenticated request.

OBS was offline during the production check, with no active fallback job.
Live Windows playback and physical iPhone validation remain required. The
measured incoming WHIP packet loss and MediaMTX HLS duration warnings are not
claimed to be resolved by these changes. Brief-indicator suppression does not
hide sustained playback stalls.
