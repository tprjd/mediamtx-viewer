# Managed OBS WHIP streaming

Status: ready-for-agent
Decision date: 2026-10-07
Branch: codex/whip-streaming

## Problem Statement

The Channel owner wants to publish at 1080p60 from Windows OBS with less than
one second of viewer delay. Short upload interruptions must recover without
repeated manual setup changes or page refreshes. Viewers must retain sound and
access to playback on an iPhone 13 with current iOS.

The existing RTMP setup does not provide this complete behavior. Standard OBS
RTMP output uses AAC audio, while this application's WebRTC path needs Opus.
The local experiment showed that low normal delay is possible, but it did not
validate Windows hardware encoding, 1080p60, physical iPhone playback, or the
application's recovery behavior.

## Solution

Offer a separate Managed OBS profile through the existing OBS setup flow.
The Channel owner selects that profile before streaming and uses the existing
scenes. The profile sends one H.264 video encode and Opus audio through WHIP.
Eligible viewers start with WebRTC unless they explicitly selected another
Playback mode.

WebRTC receives the original video and audio without server conversion. If
WebRTC cannot play, the viewer automatically falls back to smooth HLS with sound.
The planned server audio converter serves only this HLS compatibility path: it
copies H.264 video and converts Opus to AAC. The separate OBS profile does not
need audio conversion for WebRTC and does not encode multiple video qualities.

Start with David's Channel. Require 1080p60, less than one second of healthy
camera-to-screen delay, and recovery from a two-second upload interruption.
Playback must resume and return below one second of delay within five seconds
after the network returns to sufficient capacity, without a page refresh.

After HLS fallback, stay on HLS until the viewer selects WebRTC. Keep the existing
60-second retry cooldown. Sustained insufficient upload can cause stalls in this
first version; automatic quality reduction is not part of the solution.

## User Stories

1. As a Channel owner, I want a separate low-latency Managed OBS profile, so that I can select it without editing connection settings each time.
2. As a Channel owner, I want the existing OBS setup flow to create the profile, so that I do not manually copy endpoints and credentials.
3. As a Channel owner, I want to retain my RTMP profiles, so that I can still use the existing publishing workflow.
4. As a Channel owner, I want both publishing options to use my existing scenes, so that switching profiles does not require rebuilding my layout.
5. As a Channel owner, I want at least 1080p60 output, so that the low-latency option meets my picture-quality requirement.
6. As a Channel owner, I want OBS to encode one video quality level, so that it does not spend resources on unused quality levels.
7. As a Channel owner, I want a fixed bitrate selected through realistic tests, so that I understand the upload capacity needed by the profile.
8. As a Channel owner, I want setup to detect an unsupported OBS version or encoder, so that it does not create a profile that cannot work.
9. As a Channel owner, I want normal setup reruns to preserve my managed settings, so that routine maintenance does not overwrite my choices.
10. As a Channel owner, I want repair, backup, and dry-run behavior to remain available, so that profile maintenance follows the existing workflow.
11. As a Channel owner, I want stream-key rotation to update both profile types, so that the retained RTMP profile does not contain a revoked key.
12. As a Channel owner, I want setup credentials to remain absent from generic downloads and logs, so that publishing secrets are not disclosed.
13. As a viewer, I want eligible Channels to start in WebRTC automatically, so that I receive low-latency playback without an extra selection.
14. As a viewer, I want my explicit Playback mode preference respected, so that an automatic default does not override my choice.
15. As a viewer, I want less than one second of healthy camera-to-screen delay, so that I can follow live activity with little delay.
16. As a viewer, I want video and sound on my iPhone 13 with current iOS, so that I can watch from that device.
17. As a viewer, I want a two-second upload interruption to recover without refreshing the page, so that a short outage does not end my watch visit.
18. As a viewer, I want playback and sub-second delay restored within five seconds after that outage ends, so that recovery does not leave me watching old content.
19. As a viewer, I want automatic HLS fallback with sound if WebRTC cannot play, so that I can continue watching at a higher delay.
20. As a viewer, I want the player to show its fallback Playback mode, so that I can understand why the delay changed.
21. As a viewer, I want HLS playback to stay stable after fallback, so that automatic WebRTC retries do not repeatedly interrupt it.
22. As a viewer, I want to select WebRTC again after the retry cooldown, so that I can return to low latency when conditions improve.
23. As a viewer, I want my pause action respected during recovery, so that the player does not restart against my choice.
24. As a viewer, I want background and offline states handled safely, so that they do not trigger unnecessary recovery or stale playback actions.
25. As a viewer, I want sound and picture to remain synchronized through fallback, so that the fallback remains usable.
26. As a viewer, I want the same Viewing access rules on both transports, so that switching playback does not change who can watch.
27. As a Channel owner, I want a watch visit counted once across transports, so that fallback does not inflate my viewer count.
28. As a Channel owner, I want internal audio conversion excluded from viewer counts, so that an empty Channel still shows no viewers.
29. As a Channel owner, I want one live state, start time, and notification sequence, so that internal fallback media does not appear as another Channel.
30. As an administrator, I want revocation and Account suspension enforced on both media paths, so that fallback cannot bypass access restrictions.
31. As an operator, I want only the internal worker to publish fallback media, so that an external Publisher cannot replace it.
32. As an operator, I want one audio converter per active eligible Channel, so that conversion cost does not grow with each viewer.
33. As an operator, I want stale workers stopped after source changes, so that old frames cannot survive an OBS restart or profile switch.
34. As an operator, I want converter failures isolated from WebRTC, so that fallback maintenance does not interrupt healthy low-latency playback.
35. As an operator, I want actual OCI resource and egress measurements, so that I can assess the existing free-tier deployment before expansion.
36. As a Channel owner, I want a pilot on my Channel before wider availability, so that failures can be resolved before affecting other Channel owners.
37. As an operator, I want a tested return to RTMP and HLS, so that the pilot can be rolled back without changing unrelated Channels.
38. As a Channel owner, I want measurements from Windows OBS and a physical iPhone, so that a local 720p demonstration is not treated as proof of the release target.

## Implementation Decisions

- Add one distinct low-latency Managed OBS profile through the existing setup
  module. Retain the shared scene collection, canvas, RTMP profiles, and normal
  preservation behavior. Profile selection occurs before publishing, not during
  an active stream.
- Configure H.264 hardware encoding, Opus audio, one WHIP layer, zero B-frames,
  and at least 1080p60. Keep the streaming contract's two-second keyframes unless
  measurements establish a need for an explicitly reviewed contract change.
- Select the fixed bitrate through representative game-motion and text tests.
  The existing 10 Mbps H.264 setting is a candidate, not a validated WHIP default.
  Do not claim that the tested OBS WHIP implementation adapts bitrate automatically.
- Extend the OBS setup response with the WHIP endpoint and bearer credential.
  When setup rotates the Channel's stream key, refresh all existing managed RTMP
  and WHIP credentials, including profiles not selected in that setup run.
- Verify native OBS support before creating the profile. Keep the existing
  single-use OBS setup session, credential redaction, backups, repair, and dry-run
  behavior. Unsupported configurations must fail with an actionable explanation.
- Keep the canonical Publisher source as the authority for Channel live state,
  advertised tracks, start time, thumbnails, notifications, and WebRTC delivery.
  Add an HLS derivative associated with that Channel, not another Channel record.
- Deliver the original H.264 and Opus directly over WebRTC. Audio conversion is
  exclusively for the AAC HLS fallback. MediaMTX's ability to package Opus in HLS
  does not establish Safari playback compatibility; physical-device validation
  remains required. No server video encoding is planned.
- Add a supervised audio worker that reads the canonical source privately, copies
  H.264, converts Opus to AAC, and publishes the HLS derivative internally. Start
  one worker per active pilot WHIP source so fallback media is ready before use.
  Do not run a worker per viewer or derive media from another derivative.
- Bind each worker to the current source generation. Stop it when the source
  ends, switches to RTMP, or loses Streaming access. Use bounded restart delays
  and report health. An old worker must not republish stale frames. A worker
  failure must not interrupt healthy WebRTC playback.
- Authorize derivative publishing with a separate internal worker credential
  scoped to that derivative. Reject external publishing to it and worker
  publishing to the canonical source. Permit viewers to read derivative HLS
  only with the original Channel's Viewing access. Reject derivative WHEP.
- Keep production reverse-proxy and direct application-proxy authorization and
  routing consistent for playlists, segments, and query parameters. Private
  MediaMTX endpoints remain private. Revocation applies to both playback paths.
- Select the AAC derivative directly when a WHIP source enters an HLS Playback
  mode. The current alternate-HLS mechanism applies after HLS failure; it is not
  sufficient to choose the initial HLS target after WebRTC failure. Clear stale
  derivative routing when publishing switches back to RTMP.
- Aggregate canonical and derivative readers by Viewer identity in both Channel
  detail and directory status. Exclude authenticated internal worker readers.
  Derivative events must not produce extra live notifications or thumbnails.
- Base initial WebRTC selection on pilot eligibility, the active canonical
  Publisher, and compatible tracks. Preserve explicit Playback mode preferences.
  Keep automatic fallback state distinct from deliberate viewer choices where
  the current preference model requires it. Codec metadata alone does not prove
  browser decoding support.
- Keep transport actions inside the WebRTC and HLS adapters. The shared Playback
  run module retains progress and recovery eligibility. Playback mode selection
  owns cross-protocol fallback. Preserve pause, visibility, connectivity,
  cancellation, and Viewing access checks.
- Allow short interruptions to recover on the current WebRTC connection first.
  Use bounded reader recovery when necessary, guided by measurements. Prevent
  premature HLS fallback, repeated reconnect loops, and stale callbacks from
  defeating the accepted recovery target.
- Fall back to smooth HLS with sound after WebRTC cannot start or exhausts
  recovery. Remain on HLS until the viewer chooses WebRTC after the existing
  60-second cooldown. Cooldown expiry alone must not switch transports.
- Extend the authoritative streaming contract and its validation with the
  accepted WebRTC targets during implementation. They are not currently enforced
  contract values. Preserve existing HLS timing and fallback policy unless a
  measured conflict receives explicit review.
- Restrict initial availability and worker activity to David's Channel. Test
  rollback to the retained RTMP profile and existing HLS path. Expansion remains
  a separate decision after pilot evidence, including actual OCI resource use.

## Testing Decisions

- Use one primary acceptance boundary: the generated Windows OBS profile,
  deployed HTTPS and ICE routes, real MediaMTX, the application viewer, and a
  physical iPhone 13 on current iOS. The user confirmed this boundary and the
  supporting integration coverage on 2026-10-07. Extend existing playback and
  prototype infrastructure instead of creating separate test-only playback behavior.
- Test observable results: playable frames, audible synchronized sound, selected
  Playback mode, measured delay, authorized requests, accurate viewer counts,
  preserved profiles, and stopped stale media. Do not treat saved configuration,
  mocked timer calls, successful compilation, or a bare reader as release proof.
- Require at least 1080p60 with sound and healthy camera-to-screen delay below
  one second. Record the source timing reference and physical receiver together.
  Frame-age metrics support diagnosis but do not replace physical measurements.
- Repeat two-second upload outages at different keyframe positions. Playback
  must resume and return below one second of delay within five seconds after
  sufficient upload capacity returns. Test a visible, unpaused viewer. No page
  refresh is allowed. HLS fallback cannot count as passing this sub-second test.
- Save complete healthy and outage measurements, including failures, freezes,
  reconnects, and audio observations. Summarize median, high-percentile, and worst
  observed delay. Record exact OS, browser, OBS, GPU, encoder, codec, bitrate,
  keyframe, network, and VM details. Do not select only favorable samples.
- Test sustained upload capacity below the selected bitrate to document the
  accepted limitation and subsequent recovery. Test UDP and the configured TCP
  ICE route with UDP blocked. Distinguish a failed WHIP Publisher connection from
  failed viewer WebRTC: HLS fallback cannot repair a Publisher that never connects.
- Force viewer WebRTC failure while the source remains live. Verify automatic
  HLS with sound, stable synchronization, correct mode indication, no automatic
  retry loop, and manual return after the cooldown. Also test explicit HLS
  preferences, late live start, and transitions between RTMP and WHIP Channels.
- Reuse OBS setup authorization integration tests for session redemption,
  credential rotation, and protected credential delivery. Verify both retained
  RTMP publishing and generated WHIP publishing in native Windows OBS after setup,
  normal reruns, repair, and rotation. Generated text alone is insufficient.
- Reuse Viewing access and MediaMTX authorization integration tests for owners,
  approved viewers, revoked viewers, and suspended accounts. Exercise manifests
  and segments through both proxy routes. Reject external derivative publishing,
  worker publishing to source paths, and derivative WHEP access.
- Reuse MediaMTX status tests that already deduplicate reconnecting sessions and
  viewers across transports. Add source-plus-derivative cases: an internal worker
  with no viewers counts zero, and one watch visit switching transports counts
  once. Keep canonical live state, notifications, and thumbnail behavior intact.
- Reuse existing WebRTC watchdog, Playback run, and Playback mode tests for
  bounded recovery, pause, background state, offline state, access loss, and
  disposal. Use these focused tests for edge cases that are hard to reproduce
  reliably through a physical outage. They do not replace acceptance testing.
- Existing browser player tests use controlled HLS fixtures for real video and
  pause behavior. Reuse their application-level setup for relevant UI regression
  coverage. Those fixtures do not establish real WHIP transport performance.
- Test worker behavior through real source lifecycle events and resulting media:
  crash, restart, source replacement, profile switch, key rotation, MediaMTX
  restart, and Channel disablement. Confirm copied video, AAC output, stopped
  stale workers, and continued healthy WebRTC when only the worker fails.
- Measure conversion alongside the existing application on the actual OCI VM,
  with WebRTC and HLS viewers. Record CPU, memory, errors, synchronization, and
  egress. Verify current free-tier allocation and limits rather than treating
  repository defaults as the deployed VM or a capacity guarantee.
- Before pilot completion, run lint, type checking, applicable unit and
  integration tests, streaming-contract validation, build, and relevant browser
  tests. The final physical-device run uses the generated profile and complete
  implementation. Missing Windows or iPhone evidence remains outstanding.

## Out of Scope

- Automatic bitrate adaptation, simulcast, or multiple OBS video quality levels.
- Server video transcoding or an adaptive-quality ladder.
- Seamless playback while upload remains below the configured bitrate.
- Sub-second HLS playback or automatic return from HLS to WebRTC.
- Seamless publishing-protocol changes during an active OBS stream.
- Support guarantees for older iOS versions or every Windows encoder without
  device-specific validation.
- General rollout before the pilot passes and expansion is approved.
- Guaranteed traversal of every restrictive network or a new TURN deployment
  without evidence that the current ICE paths are insufficient.
- Replacing the existing RTMP publishing option, access model, or scene collection.
- Production implementation, deployment, or a release-version change as part of
  this specification task.

## Further Notes

The interview decisions were accepted on 2026-10-07. The user explicitly chose
1080p60 minimum instead of the suggested 720p30 starting point. Automatic HLS
fallback with sound remains an accepted requirement; the later audio-converter
question requested clarification and did not withdraw it.

The earlier statement that a separate OBS profile removes server audio conversion
was incomplete. It removes conversion from the WebRTC path. The AAC compatibility
path exists because audible HLS fallback is also required. This plan does not
claim that Opus HLS failure has already been reproduced on the target iPhone.

The [native OBS experiment](issues/02-native-obs-upload-test.md) measured 426 ms
median frame age at 720p30 and about 2 Mbps. Connections survived a two-second
outage, but sustained insufficient bandwidth produced poor playback without OBS
WHIP bitrate reduction. It used a bare Mac reader; its RTMP comparison omitted
AAC audio. These findings support further work, not 1080p60 release acceptance.

The specification replaces the earlier plan in place. The existing issue order
and dependencies remain:

| Issue | Deliverable | Depends on |
| --- | --- | --- |
| [03](issues/03-validate-1080p60-whip.md) | Measured Windows 1080p60 configuration and application recovery findings | Existing prototype |
| [04](issues/04-hls-audio-fallback.md) | Authorized AAC HLS fallback and correct Channel accounting | 03 |
| [05](issues/05-managed-whip-profile.md) | Generated WHIP profile and credential maintenance | 03 |
| [06](issues/06-playback-selection-and-recovery.md) | Initial selection, recovery, and fallback behavior | 03, 04 |
| [07](issues/07-pilot-validation-and-rollout.md) | Complete pilot evidence and expansion review | 04, 05, 06 |

The first experiment can expose recovery defects for issue 06. It does not need
to claim final acceptance before those defects are repaired. Final validation
repeats the full flow after all implementation work is complete.

Implementation uses the existing checkout on `codex/whip-streaming`, created
from `main`. Prototype tools remain on `codex/prototype-stream-resilience` at
commit `cfa2f6f`. Retrieve selected tools from that branch when needed. The spec,
tickets, and saved evidence are carried into the implementation branch.

Update the maintained Windows setup and Oracle deployment guides when
implementation establishes the final behavior.
Do not claim that the prototype or this specification has deployed the feature.

Primary references for the technical constraints:

- [OBS WHIP guide](https://obsproject.com/kb/whip-streaming-guide)
- [OBS profiles](https://obsproject.com/kb/profiles)
- [MediaMTX HLS support](https://mediamtx.org/docs/read/hls)
- [Apple HLS authoring specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/)
- [OCI Always Free documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
