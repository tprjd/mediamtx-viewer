# Windows OBS Multi-Profile Setup Plan

## Goal

Extend `scripts/windows/setup-frankerzspam-obs.ps1` so one setup run can create
managed OBS streaming profiles for AV1, HEVC/H.265, and H.264 at both 2560x1440
60 FPS and 1920x1080 60 FPS. Keep the existing scene collection, WHIP device
authorization, credential-handling guarantees, and preservation of unrelated
OBS configuration.

This plan interprets “HEVC” as H.265 and assumes the desired result is a full
three-codec by two-resolution matrix. The implementation must not transcode on
the Oracle VM; each selected OBS profile publishes its codec directly through
WHIP to MediaMTX.

## Compatibility constraints

- The deployed `bluenviron/mediamtx:1.20.1` path can carry AV1, H.265, and H.264
  through WebRTC/WHEP. MediaMTX remains a pass-through server.
- OBS WHIP supports H.264 and AV1, and supports HEVC when its Windows build has
  HEVC enabled. The setup must verify the installed encoder inventory instead
  of assuming support from the GPU model.
- HEVC must be labeled **limited browser compatibility**. Many browsers cannot
  receive H.265 over WebRTC, and some support it only on particular operating
  systems and hardware. HLS fallback does not transcode it.
- H.264 is the broad-compatibility profile. Configure a WebRTC-compatible
  profile with no B-frames; prefer Baseline/Constrained Baseline when the
  selected hardware encoder exposes it and validate the emitted stream.
- Every profile uses Opus audio because OBS WHIP and the existing playback path
  already use it.
- All profiles retain a two-second keyframe interval and zero B-frames. Do not
  silently substitute another codec when a requested hardware encoder is
  unavailable.

Primary references:

- [MediaMTX WebRTC codec support](https://mediamtx.org/docs/read/webrtc)
- [MediaMTX browser codec constraints](https://mediamtx.org/docs/features/webrtc-specific-features)
- [OBS WHIP codec registration and packetizers](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-webrtc/whip-output.cpp)

## Managed profile matrix

Create only profiles whose codec has a verified hardware encoder in the fresh
OBS startup log. The proposed balanced defaults are:

| Managed profile | Output | Codec | CBR video bitrate | Compatibility role |
| --- | --- | --- | ---: | --- |
| `FrankerzSpam 1440p60 AV1` | 2560x1440 60 FPS | AV1 | 12,000 Kbps | Best quality-per-bit; current default |
| `FrankerzSpam 1440p60 HEVC` | 2560x1440 60 FPS | HEVC/H.265 | 14,000 Kbps | Experimental/limited browser support |
| `FrankerzSpam 1440p60 H264` | 2560x1440 60 FPS | H.264 | 16,000 Kbps | Broad compatibility, higher bandwidth |
| `FrankerzSpam 1080p60 AV1` | 1920x1080 60 FPS | AV1 | 8,000 Kbps | Efficient lower-bandwidth option |
| `FrankerzSpam 1080p60 HEVC` | 1920x1080 60 FPS | HEVC/H.265 | 9,000 Kbps | Experimental lower-bandwidth option |
| `FrankerzSpam 1080p60 H264` | 1920x1080 60 FPS | H.264 | 10,000 Kbps | Recommended compatibility option |

These are initial values, not adaptive variants. OBS publishes exactly one
profile at a time, and every viewer of that channel consumes approximately that
profile's bitrate from the VM. Confirm the values with real game motion,
publisher upload stability, viewer count, and OCI network metrics before making
them permanent.

All six profiles otherwise share the existing settings:

- 60 FPS, NV12, Rec. 709, limited range, Lanczos scaling;
- CBR, two-second keyframes, zero B-frames;
- no stream rescale beyond the profile's declared output resolution;
- one WHIP simulcast layer and multitrack video disabled;
- Opus at 48 kHz stereo and 160 Kbps;
- reconnect enabled, two-second retry delay, 25 retries, and low-latency mode;
- MKV recording defaults remain unchanged.

## User experience

1. The normal downloaded launcher installs or updates OBS and probes its fresh
   encoder inventory once.
2. It prints a concise capability summary by GPU vendor and codec.
3. By default, it offers to create both resolutions for every supported hardware
   codec. An unsupported codec is listed as skipped with the missing encoder
   reason.
4. If no supported hardware video encoder is found, setup stops before browser
   authorization or profile writes.
5. It asks for microphone and hotkey choices only when creating or rebuilding
   the single shared `FrankerzSpam Games` scene collection.
6. It shows the exact profile list and bitrates before confirmation.
7. It performs one browser authorization. The returned WHIP URL and bearer token
   are written to every managed profile created or retained by this run, then
   cleared from in-memory variables without being printed.
8. It creates one `FrankerzSpam OBS` shortcut that opens the existing 1440p60
   AV1 profile when available. Otherwise, prefer 1080p60 H.264, then the first
   successfully created profile. The shortcut continues to use the shared scene
   collection.
9. OBS opens on that preferred profile and the script tells the user how to
   switch profiles from **Profile** in OBS.

Add optional non-interactive selection parameters for support and testing:

```powershell
.\Setup-FrankerzSpam-OBS.cmd -Codecs AV1,H264 -Resolutions 1440p,1080p
```

- `-Codecs` accepts `AV1`, `HEVC`, and `H264`; default is all three.
- `-Resolutions` accepts `1440p` and `1080p`; default is both.
- Explicitly requesting an unavailable codec is a hard failure before any
  configuration write. The default all-codec run may skip unsupported codecs
  after displaying them and receiving confirmation.
- Retain `-BitrateKbps` for backward compatibility as an override for only the
  1440p60 AV1 profile. Add no six-parameter bitrate interface in this revision;
  profile defaults remain centralized in the matrix.
- `-DryRun` prints the resolved matrix and capability information from existing
  logs, but does not install, probe, authorize, or write.
- `-UpdateOnly`, `-RepairManagedConfig`, and `-ResetManagedConfig` keep their
  current mutual-exclusion rules and apply consistently to the selected managed
  profile set.

## Script design

### 1. Replace singular globals with profile definitions

Introduce one ordered profile-definition array near the top of the script. Each
entry contains:

- stable profile key, display name, and directory name;
- codec key and output dimensions;
- default bitrate and compatibility label;
- preferred-launch priority;
- the selected OBS encoder identifier, populated after capability detection.

Keep canvas and output dimensions equal per profile. This avoids hidden rescale
behavior and makes profile switching self-contained.

### 2. Generalize encoder discovery

Replace `Find-EncoderInLogs` and `Get-HardwareAv1Encoder` with functions that
return a capability map rather than one encoder identifier:

```text
AV1  -> selected NVIDIA, AMD, or Intel hardware encoder ID
HEVC -> selected NVIDIA, AMD, or Intel hardware encoder ID
H264 -> selected NVIDIA, AMD, or Intel hardware encoder ID
```

Maintain explicit allowlists of OBS 31/32 internal encoder identifiers by codec
and vendor. Select NVIDIA, then AMD, then Intel within each codec, matching the
existing AV1 behavior. Confirm the exact H.264 and HEVC identifiers against
fresh OBS 31 and 32 Windows logs before merging; do not infer identifiers solely
from current source names or GPU models.

The capability resolver must distinguish:

- codec not compiled into the installed OBS WHIP output;
- no supported hardware encoder in the OBS inventory;
- requested encoder present but unusable at stream initialization, which only a
  manual test stream can prove.

### 3. Generate codec-specific encoder settings

Change `Get-EncoderSettings` to accept the profile definition and dispatch on
both codec and encoder vendor. Common settings are CBR, bitrate, two-second
keyframes, and zero B-frames.

- NVIDIA: retain P5, high-quality tuning, quarter-resolution multipass,
  look-ahead off, and psycho-visual tuning on where the codec-specific plugin
  supports those keys.
- AMD: retain the Quality preset where exposed.
- Intel: retain Balanced target usage where exposed.
- AV1: retain Main profile.
- HEVC: use Main, 8-bit 4:2:0 output; do not enable Main10/HDR in this revision.
- H.264: prefer Baseline/Constrained Baseline for browser compatibility. If a
  hardware plugin cannot express it, record and validate the exact negotiated
  profile in the test matrix instead of assuming `profile=main` or `high` is
  universally safe.

Encoder JSON property names vary between NVIDIA, AMD, and Intel plugins. Capture
known-good `streamEncoder.json` fixtures from OBS 31 and 32 for each available
vendor/codec combination and use those fixtures to validate the generated keys.

### 4. Make profile writing data-driven

Update `Write-ManagedProfile` to receive a profile definition. Parameterize:

- profile name;
- base/output width and height;
- encoder identifier;
- bitrate and codec-specific JSON.

Keep all unrelated `basic.ini` values identical. Write each profile atomically.
Compute all selected definitions and validate names, paths, bitrates, dimensions,
and encoders before writing the first profile.

### 5. Preserve and back up multiple profiles safely

Generalize `Backup-ManagedConfiguration` to receive all selected managed profile
directories plus the one scene collection. Back up `basic.ini` and
`streamEncoder.json` from each profile into distinct named subdirectories.
Continue excluding `service.json` so the bearer token is not copied into backup
files.

- Normal rerun preserves existing managed profile output settings.
- Repair rewrites the selected managed profiles after one confirmation and
  backup.
- Reset rewrites selected managed profiles and the shared scene collection after
  one confirmation and backup.
- Never remove profiles outside the six exact managed directory names.
- If only a subset is selected, leave other managed profiles untouched, but do
  not treat them as authorization targets unless they are discovered as one of
  the six exact managed profiles.

### 6. Distribute one credential to all managed profiles

Change `Write-WhipService` to accept a list of exact managed profile directories.
After successful device authorization, atomically write the same new
`service.json` to every existing managed profile in the six-profile set, not
only profiles whose encoder settings changed. This prevents an old profile from
silently retaining the publishing key that authorization just rotated.

Validate the full target list before the first credential write. If a write
fails partway through, report exactly which managed profiles were updated and
which were not; never print or back up the token. A rerun can safely rotate the
key again and converge all profiles.

### 7. Update messages and shortcut selection

Remove AV1-only wording from startup, dry-run, confirmation, completion, and
failure messages. Report skipped codecs and HEVC's compatibility limitation.
Pass the chosen preferred profile into `New-DesktopShortcut` instead of reading
a singular global `$ProfileName`.

## Tests and verification

### Automated repository tests

Extend `lib/obs-setup.integration.test.ts` and, if practical, add isolated
PowerShell tests for the data-driven functions. Verify that:

- the embedded launcher remains deterministic and contains no credential;
- the script version in TypeScript and PowerShell is bumped together;
- six unique profile names and directory names exist;
- the two exact resolutions and all three codecs resolve correctly;
- every profile has CBR, a two-second keyframe interval, zero B-frames, Opus,
  and the expected default bitrate;
- H.264 and HEVC encoder allowlists contain only reviewed OBS identifiers;
- explicit unavailable codec selection fails before profile writes;
- default selection skips unsupported codecs only after confirmation;
- repair/reset backup every selected profile without copying `service.json`;
- one authorization writes service configuration to every exact managed profile;
- shortcut fallback priority is deterministic;
- dry-run performs no writes or authorization;
- unrelated profiles and scene collections are never selected by prefix or glob.

Run the normal repository checks after implementation:

```sh
npm test
npm run lint
npm run build
```

Also parse the final PowerShell payload with Windows PowerShell 5.1 and
PowerShell 7 before producing the launcher hash.

### Windows/OBS compatibility matrix

On clean Windows 10 and 11 user accounts, test OBS 31 and 32 with every available
vendor combination:

- NVIDIA hardware AV1, HEVC, and H.264;
- AMD hardware AV1, HEVC, and H.264;
- Intel hardware AV1, HEVC, and H.264;
- older hardware with H.264/HEVC but no AV1;
- hardware with only a supported H.264 encoder.

For each generated profile:

1. Confirm OBS loads the profile without rewriting or dropping encoder keys.
2. Start a short WHIP stream and confirm the selected encoder initializes.
3. Confirm MediaMTX reports the intended codec, resolution, FPS, and audio track.
4. Test WebRTC and HLS playback in current Chrome, Edge, Firefox, and Safari on
   representative Windows, macOS, iOS, and Android devices.
5. Confirm H.264 playback has no B-frames and works on the broadest test set.
6. Record HEVC failures as expected compatibility limitations; do not promote
   HEVC as a default until the actual viewer fleet passes.
7. Switch profiles and confirm the same channel credential works without another
   setup run.
8. Rotate authorization and confirm every managed profile receives the new key
   while the old publisher is disconnected.

### Deployment observation

Run at least one 30-minute game stream for each proposed bitrate. Observe
publisher loss, WHEP/HLS errors, thumbnail-worker CPU spikes, VM outbound
throughput, and client decode failures. Because MediaMTX does not create adaptive
renditions, test weak viewer connections explicitly. Adjust matrix bitrates only
from collected results and update both script fixtures and documentation in the
same change.

## Documentation and versioning

- Bump `OBS_SETUP_SCRIPT_VERSION` and `$ScriptVersion` because the managed
  configuration contract and accepted CLI parameters change.
- Update `scripts/windows/README.md`, `README.md`, the account/channel UI copy,
  and the original `docs/windows-obs-setup-plan.md` to point to this extension.
- Document that OBS profiles are alternatives, not simultaneous adaptive
  renditions.
- Clearly label HEVC as limited compatibility and 1080p60 H.264 as the safest
  viewer option.
- List the generated default bitrates and explain that every viewer consumes the
  chosen source bitrate from the VM.

## Implementation sequence

1. Capture and review real OBS 31/32 Windows encoder logs and encoder JSON
   fixtures for the available GPU vendors.
2. Add the profile matrix, selection validation, and capability-map discovery.
3. Make encoder settings and profile generation data-driven.
4. Generalize backup, repair/reset, credential distribution, and shortcut logic.
5. Expand automated tests and bump the setup protocol/script version.
6. Update documentation and UI text.
7. Run repository checks and PowerShell parsing.
8. Complete the Windows/OBS codec matrix and a live MediaMTX deployment test.

## Acceptance criteria

- One default setup run can generate all supported entries in the six-profile
  matrix and one shared scene collection.
- Unsupported hardware codecs are never silently replaced with another codec.
- Every generated profile can initialize a WHIP publisher with the intended
  codec on validated hardware.
- H.264 is demonstrably free of B-frames and plays on the broad compatibility
  test set; HEVC is visibly labeled as limited compatibility.
- One authorization converges all exact managed profiles on the same current
  publishing credential without printing or backing it up.
- Repair, reset, dry-run, update-only, backup, and unrelated-profile preservation
  retain their current safety guarantees.
- The existing 1440p60 AV1 profile remains stable and is not renamed or silently
  downgraded.
