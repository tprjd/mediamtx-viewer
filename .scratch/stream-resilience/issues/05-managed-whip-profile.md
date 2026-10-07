# 05: Create and use the separate OBS profile

**What to build:** The Channel owner runs the existing OBS setup, selects the
new low-latency Managed OBS profile, and publishes 1080p60 with sound. Eligible
viewers start in WebRTC unless they explicitly selected another Playback mode.
Existing scenes and RTMP profiles continue to work.

**Blocked by:** 03: Verify 1080p60 through the real viewer (resolved).

**Status:** needs-info

Type: task
Spec: [Managed OBS WHIP streaming](../spec.md)

- [ ] Capture the user's working OBS configuration from the completed baseline
  before selecting profile defaults. Record encoder, bitrate, OBS version, and
  keyframe settings; do not infer them from the older 720p prototype.
- [ ] Extend the existing OBS setup session to provide WHIP connection details.
  Create one distinct Managed OBS profile for H.264, Opus, one video layer,
  1080p60 minimum, zero B-frames, and the contract's two-second keyframe interval.
- [ ] Detect unsupported OBS versions and encoders before producing an unusable
  profile. Keep credentials out of generic downloads, logs, and ordinary backups.
- [ ] Restrict the new option to the pilot Channel. Native Windows OBS loads the
  generated profile and publishes through the deployed HTTPS endpoint. Verify
  actual outgoing codecs, resolution, frame rate, and sound.
- [ ] Preserve the shared scene collection, canvas, layout, and RTMP profiles.
  Normal setup reruns do not duplicate profiles or overwrite retained settings.
  Existing repair, backup, reset, and dry-run behavior remains available.
- [ ] When setup rotates the stream key, update all existing managed RTMP and
  WHIP credentials, including profiles not selected in that setup run. Verify
  publishing with both profile types after rotation.
- [ ] Start eligible WHIP Channels in WebRTC when no explicit Playback mode
  preference exists. Respect saved preferences and preserve existing RTMP default
  behavior. Test a Channel becoming live and switching publishing profile.
- [ ] Keep automatic fallback state distinct from deliberate viewer choices where
  needed. A transient fallback must not be misrepresented as an explicit choice.
- [ ] Verify the complete setup-to-playback workflow and use existing setup
  authorization and Playback mode tests for edge cases. Generated profile text
  alone is not proof of successful publishing.

## Independent verification

Demonstrate the healthy path with the generated Windows profile and actual
viewer. This ticket does not depend on the new HLS converter or the recovery
changes. Their integration with the generated profile is verified in ticket 07.

## Comments

The user selects a profile before streaming. Seamless publishing-protocol
switching during an active stream is outside scope.

2026-10-07: Approved with ticket 03 as its only blocker, now resolved by
the user's test report. Initial automatic WebRTC selection belongs to this
complete setup-to-playback slice. HLS fallback belongs to ticket 04.


2026-10-07 implementation: Added the pilot Managed OBS WHIP profile, protected
setup response, credential refresh for retained RTMP and WHIP profiles, and
automatic WebRTC defaults with separate fallback state. Setup and Playback mode
integration tests cover authorization, rotation, late live start, preferences,
cooldown, and profile changes. Executable PowerShell checks cover profile output,
canvas preservation, reruns, repair, credential updates, backups, and rejected
unsupported settings.

The user does not know the encoder or bitrate from their earlier Windows test.
The initial H.264 bitrate remains a configurable 10 Mbps candidate, not a measured
default. This ticket remains open pending native Windows publishing with the
generated profile, physical iPhone validation, and both profile types publishing
after rotation. No deployment or physical-device result is claimed.
