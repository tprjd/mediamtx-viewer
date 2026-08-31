# Windows OBS Setup Script Plan

Status: version 1 implemented in the repository. Application, authorization,
checksum, and PowerShell syntax validation are automated. Final acceptance on
a Windows 10/11 computer with supported AV1 hardware remains required before
calling the Windows setup production-proven.

## Goal

Create a safe, repeatable single-file Windows launcher with an embedded
PowerShell payload that installs or updates OBS Studio on Windows 10/11 and
creates a FrankerzSpam-specific 2560x1440, 60 FPS AV1 streaming profile with
manually selected scenes for the requested games and the desktop.

An authenticated user will download the latest script from their channel page
and run that single file. The script will install or update OBS, configure it,
and obtain the user's channel publishing credentials through a short-lived
browser authorization flow. Users will not need to copy a WHIP URL or stream
key manually.

The script must preserve unrelated OBS profiles and scene collections. It must
never silently fall back from AV1 to another codec.

## Implemented files

- `scripts/windows/setup-frankerzspam-obs.ps1`: reviewed Windows PowerShell 5.1
  compatible payload source.
- `lib/obs-setup-script.ts`: deterministic `Setup-FrankerzSpam-OBS.cmd`
  generator with embedded base64 payload and a fixed payload checksum.
- `lib/obs-setup.integration.test.ts`: isolated integration coverage for setup
  state transitions, expiry, ownership, replay rejection, rate limits, route
  behavior, artifact metadata, and credential redaction.
- `app/account/channel/obs-setup.cmd/route.ts`: authenticated generic launcher
  download generated from the reviewed source with a stable SHA-256 checksum.
- `app/account/channel/obs-setup/[code]/page.tsx`: authenticated approval UI.
- `app/api/obs-setup/device/start` and `poll`: narrowly scoped public device
  endpoints with small streamed request bodies and IP/session rate limits.
- `migrations/004_obs_setup_sessions.sql`: hashed, expiring, single-use setup
  sessions and rate-limit state.

There will be no separate bootstrapper, ZIP archive, configuration file, or
stream-key file to download.

## Command modes

```powershell
.\Setup-FrankerzSpam-OBS.cmd
.\Setup-FrankerzSpam-OBS.cmd -DryRun
.\Setup-FrankerzSpam-OBS.cmd -UpdateOnly
.\Setup-FrankerzSpam-OBS.cmd -RepairManagedConfig
.\Setup-FrankerzSpam-OBS.cmd -ResetManagedConfig
```

- Default: install or update OBS and create missing managed configuration.
- `-DryRun`: inspect the computer and describe every proposed change without
  installing or writing anything.
- `-UpdateOnly`: update OBS without touching any OBS configuration.
- `-RepairManagedConfig`: back up and repair required managed settings while
  preserving unrelated settings where possible.
- `-ResetManagedConfig`: require confirmation, back up the managed profile and
  collection, and recreate them from the defaults.

Normal reruns must not overwrite user customizations in the managed scenes.

## Installation and update behavior

1. Verify Windows 10/11 x64 and PowerShell 5.1 or newer.
2. Detect `winget` and display a clear installation link if it is unavailable.
3. Ask the user to close OBS if it is running.
4. Install or upgrade only the exact `OBSProject.OBSStudio` package.
5. Detect the installed OBS version and configuration directory.
6. Accept validated OBS major versions 31 and 32. Refuse to write configuration
   for an older or untested future format while still allowing `-UpdateOnly`.
7. Do not keep the entire script elevated. Allow the OBS installer to request
   elevation separately if Windows requires it.

The script will not download OBS installers from arbitrary URLs and will rely
on WinGet's package verification.

## Download and one-script setup flow

The channel page will add a **Download Windows OBS setup** action. It will be
shown only to an active signed-in user who owns an enabled channel.

The downloaded file will be a generic CMD launcher, not a per-user artifact.
This keeps the bytes identical for every user and gives the release artifact a
stable SHA-256 checksum. It will contain no username, channel slug, WHIP URL,
bearer token, session cookie, or other secret.

Planned flow:

1. The user signs in, opens `/account/channel`, downloads the CMD launcher, and
   double-clicks it.
2. The channel page displays the exact version and SHA-256 checksum. Version one
   is unsigned, so Windows can still display a publisher or SmartScreen warning.
   The launcher must not disable SmartScreen, Defender, or persistent Windows
   security controls.
3. The launcher verifies its embedded payload checksum, writes it to a random
   temporary path, unblocks that verified copy, and runs it with `RemoteSigned`
   for the child PowerShell process only. It does not use `ExecutionPolicy
   Bypass` or change CurrentUser/LocalMachine policy, and removes the temporary
   payload after execution.
4. The script installs or updates OBS, performs hardware and AV1 preflight, and
   prepares the managed profile and scene collection without a stream key.
5. After preflight succeeds, the script explains that final authorization will
   rotate the channel's current OBS key and disconnect an existing publisher.
6. The script creates a short-lived device setup session and opens the default
   browser to the site's complete verification URL.
7. The already signed-in user reviews the channel name and requested action,
   then selects **Authorize OBS setup**. Login is required if the browser no
   longer has an active session.
8. The script polls at the server-provided interval. After authorization, the
   server returns the exact channel WHIP URL and a newly generated stream key
   once over HTTPS.
9. The script writes those values directly into the managed OBS profile, clears
   its in-memory credential variables, verifies the resulting profile without
   printing the key, and launches OBS.

The browser authorization step is intentional. It lets a single static script
configure the correct user's channel without embedding a durable secret
in the downloaded file.

### Site download requirements

- Serve the script only from the canonical HTTPS site.
- Require an active session and an owned, enabled channel on the download page.
- Send `Content-Disposition: attachment` with a stable filename such as
  `Setup-FrankerzSpam-OBS.cmd`.
- Send `Cache-Control: private, no-store`, `Pragma: no-cache`, and
  `X-Content-Type-Options: nosniff`.
- Display the release version, unsigned status, launcher SHA-256 checksum,
  supported Windows versions, double-click instructions, and a short
  explanation of what the script changes.
- Keep the source script in the repository and make the downloadable artifact
  reproducible from that source.
- Do not generate or store a customized script for each user.
- Do not include credentials in URLs, filenames, analytics, proxy logs, or
  browser-visible query parameters.

Version one is intentionally unsigned. A signed executable or installer can be
added later without changing the browser authorization protocol. The launcher
must not work around the unsigned status with `ExecutionPolicy Bypass`; its
`RemoteSigned` override is limited to the verified child process.

### Setup authorization requirements

The authorization protocol will follow a limited device-code style flow:

- The script receives a high-entropy device secret, a short human-readable
  code, a complete browser verification URL, an expiry, and a polling interval.
- Store only a cryptographic hash of the device secret in SQLite.
- Expire an unapproved setup session after ten minutes.
- Make approval and credential delivery single-use.
- Bind approval to the authenticated user and the enabled channel they own.
- Recheck account activation, channel ownership, and channel enabled state when
  credentials are delivered, not only when approval is clicked.
- Rotate the publishing key only after AV1 preflight and browser approval have
  succeeded.
- Use the existing channel stream-key generator, hashing, publisher disconnect,
  and audit mechanisms.
- Record setup approval, denial, and redemption audit events without recording
  either secret. Anonymous starts, ordinary pending polls, and expiry cleanup
  are deliberately not added to the user audit log.
- Rate-limit session creation, polling, and failed codes by IP and setup
  session.
- Return a neutral pending response before approval and avoid exposing whether
  a username or channel exists.
- Reject expired, consumed, malformed, or channel-mismatched sessions.
- Delete expired setup records after a short retention window with routine
  database cleanup.

Only the exact setup-start and setup-poll endpoints may bypass the site's normal
browser-session boundary. They must accept only the documented methods and
content types, enforce small request bodies, and authenticate every operation
with the high-entropy device secret. The browser approval endpoint remains
behind normal website authentication.

If credential delivery is interrupted after key rotation, the script must not
print the key or fall back to an insecure recovery mechanism. It will preserve
the previous managed profile backup, report that a fresh download/authorization
is required, and the next successful authorization will rotate the unusable key
again.

## Managed OBS objects

- Profile: `FrankerzSpam 1440p60 AV1`
- Scene collection: `FrankerzSpam Games`
- Optional desktop shortcut: `FrankerzSpam OBS`

OBS output settings and scenes are separate objects, so the script will manage
the Profile and Scene Collection independently. Existing objects with other
names are out of scope and must not be changed.

Before a repair or reset, the script will create a timestamped backup under the
current user's local application-data directory. It will avoid duplicating the
WHIP bearer token into ordinary backup or log files.

## Required AV1 profile

Proposed initial defaults:

| Setting | Value |
| --- | --- |
| Base canvas | 2560x1440 |
| Stream output | 2560x1440 |
| Frame rate | 60 FPS |
| Video codec | AV1 hardware encoding, required |
| Rate control | CBR |
| Initial bitrate | 12 Mbps, configurable during setup |
| Allowed bitrate range | 8-20 Mbps |
| Keyframe interval | 2 seconds |
| B-frames | 0, required by OBS WHIP for WebRTC compatibility |
| Color format | NV12 |
| Color space | Rec. 709 |
| Color range | Limited |
| Audio codec | Opus |
| Audio format | 48 kHz stereo |
| Audio bitrate | 160 Kbps |

The initial 12 Mbps AV1 bitrate is intended as a quality and upload-bandwidth
balance for 1440p60. The setup prompt will explain that each viewer consumes
approximately the same outbound stream bitrate because MediaMTX does not
transcode or create lower-resolution variants.

### Encoder selection

The script will inventory GPUs first, then use the installed OBS encoder list as
the authoritative compatibility check. It will select a hardware encoder in
this order only when OBS reports it as available:

1. NVIDIA NVENC AV1 on a compatible NVIDIA GPU.
2. AMD AMF AV1 on a compatible AMD GPU.
3. Intel Quick Sync AV1 on a compatible Intel GPU.

The exact internal encoder identifier comes from the fresh OBS startup log for
the installed, supported version. Version 1 recognizes the current NVIDIA,
legacy NVIDIA, AMD, and Intel hardware-AV1 identifiers.

There will be no H.264, HEVC, x264, AOM, or SVT-AV1 fallback. Software AV1 is
not an acceptable silent fallback for 1440p60. If no hardware AV1 encoder is
available, the script will make no managed profile change and will explain the
GPU or driver requirement.

After setup, OBS will be launched with the managed profile and collection. The
script will inspect the new OBS log and confirm that the selected AV1 encoder is
listed. A short manual test stream remains required to prove that the encoder
can initialize at 1440p60.

## Publishing configuration

The browser authorization flow will supply the WHIP server URL and one-time OBS
bearer token directly to the running script. Neither value needs to be copied
from `/account/channel`, and the bearer token will never be accepted as a
command-line parameter.

The token will not be printed, included in diagnostic output, copied to the
clipboard, placed in an environment variable, or duplicated in an unencrypted
backup. OBS necessarily retains the publishing credential in its own managed
profile configuration. The script will explain this before authorization.

The existing manual Generate/Rotate Stream Key control will remain available as
a recovery and advanced-user path. Authorizing the script will use the same
rotation semantics and invalidate any previous OBS key.

## Scene collection

Scene switching will be manual. There will be no process-driven automatic
scene switcher in version one.

| Scene | Enabled primary source | Included fallback |
| --- | --- | --- |
| `Desktop` | Display Capture for the selected monitor | None |
| `League of Legends` | Capture any fullscreen game | Disabled Window Capture selected while the client is running |
| `EVE Online` | Capture any fullscreen game | Disabled Window Capture selected while the game is running |
| `STALKER 2` | Capture any fullscreen game | Disabled Window Capture selected while the game is running |
| `Path of Exile` | Capture any fullscreen game | Disabled Window Capture selected while the game is running |
| `Path of Exile 2` | Capture any fullscreen game | Disabled Window Capture selected while the game is running |
| `Generic Game` | Capture any fullscreen game | None |

Every visual source will be fitted to the 2560x1440 canvas. Game Capture will be
preferred for 3D games. Window Capture fallbacks remain disabled until the user
needs one, preventing two copies of a game from appearing at once.

Executable-only targets are not generated: OBS renders their missing title and
window class as `(null)` and they do not bind reliably. The enabled Game Capture
source instead hooks whichever fullscreen game is running. Each named scene has
its own copy so it can be customized independently. If a game cannot be hooked,
the user starts it, selects the disabled Window Capture fallback in OBS, and
then enables that fallback.

## Optional hotkeys

Hotkeys are opt-in during setup because global combinations can conflict with
games. The proposed defaults are:

| Hotkey | Scene |
| --- | --- |
| `Ctrl+Alt+1` | Desktop |
| `Ctrl+Alt+2` | League of Legends |
| `Ctrl+Alt+3` | EVE Online |
| `Ctrl+Alt+4` | STALKER 2 |
| `Ctrl+Alt+5` | Path of Exile |
| `Ctrl+Alt+6` | Path of Exile 2 |
| `Ctrl+Alt+0` | Generic Game |

The script will show the proposed combinations and allow hotkeys to be skipped.

## Display and audio setup

The setup uses the Windows primary display, default desktop output, and asks
whether to enable the default microphone. These stay device-default so audio
hardware changes do not immediately invalidate the collection. Users can
select a different display or device in OBS after setup.

The first version will not add webcams, overlays, alerts, noise suppression,
compressors, or application-specific audio routing.

## User-visible safety behavior

- Show a summary and require confirmation before the first write.
- Redact the bearer token and other secrets from all output.
- Display that version one is unsigned and publish the exact CMD SHA-256 checksum.
- Complete channel authorization in the authenticated browser rather than
  collecting a website password in PowerShell.
- Never read or export browser cookies.
- Create only namespaced FrankerzSpam objects.
- Never delete unrelated OBS data.
- Never replace managed objects on a normal rerun.
- Use explicit confirmation for reset mode.
- Write managed files atomically so a failed write does not leave a partial
  JSON or INI file. Repair/reset backups exclude the credential-bearing service
  file.
- Return a non-zero exit code for incomplete installation, missing AV1 support,
  invalid stream settings, or failed verification.

## Known limitations

- AV1 playback depends on each viewer's browser, operating system, and decoder
  support. The server passes AV1 through and does not transcode it to H.264.
- Version one is unsigned, so Windows may show a publisher or SmartScreen
  warning. Signing can be added later.
- Running the script still involves normal Windows security confirmation and
  browser approval; the script will not bypass either one.
- GPU model detection alone cannot prove encoder availability; the installed
  OBS encoder list and a test stream are required.
- A GPU that exposes AV1 may still fail 1440p60 because of drivers, concurrent
  encoder use, thermals, or load.
- Existing collections created before setup version 1.0.3 are backed up and
  rebuilt once to remove executable-only capture targets.
- Some anti-cheat systems can interfere with Game Capture.
- OBS and a game normally need compatible Windows privilege levels.
- A game may need to run once before an exact Window Capture match can be
  selected.
- A stable upload connection is required at the chosen bitrate.

## Validation plan

### Automated in the repository

- Parse the complete source with the PowerShell SDK before release.
- Test the download headers, exact artifact checksum, authorization state
  transitions, token hashing, expiry, ownership checks, rate limits, replay
  rejection, audit records, and log redaction.
- Verify that the published release artifact is byte-for-byte identical to the
  artifact offered to every user.
- Verify that missing AV1 support causes a safe failure without H.264 fallback.

Pester behavior tests on a Windows runner remain a useful follow-up after the
first physical Windows validation; the Linux application suite cannot exercise
WinGet, Windows capture plugins, or an installed hardware encoder.

### Windows test machine

1. Run `-DryRun` and confirm that it writes nothing.
2. Download the launcher from an authenticated channel page, verify its
   displayed SHA-256 checksum, and confirm it starts by double-click without a
   permanent execution-policy change.
3. Install OBS on a clean Windows user account.
4. Confirm that unrelated OBS objects survive setup and reset tests.
5. Confirm OBS opens with `FrankerzSpam 1440p60 AV1` and
   `FrankerzSpam Games` selected.
6. Confirm the OBS log reports an AV1 hardware encoder at 2560x1440 and 60 FPS.
7. Confirm browser authorization binds the script to the signed-in user's
   channel and that the setup code cannot be reused.
8. Stream for at least five minutes and watch from the deployed site.
9. Test Desktop and every installed game scene individually.
10. Confirm the League lobby and in-game client are both captured.
11. Rotate the stream key and confirm rerunning setup can replace only the saved
   publishing credential.
12. Run setup again and confirm it preserves scene customizations.
13. Test expiry, denied approval, lost network, repeated polling, interrupted
    credential delivery, disabled accounts, disabled channels, and attempted
    cross-channel authorization.

## Version-one acceptance criteria

Version one is complete when:

- OBS can be installed and updated through the script.
- Existing unrelated OBS data is preserved.
- The managed profile is 2560x1440 at 60 FPS using verified hardware AV1 and
  Opus audio.
- Unsupported hardware fails clearly without a codec fallback.
- WHIP credentials can be received without appearing in logs, command-line
  history, manual copy/paste, or the downloaded script.
- An authenticated channel owner can download one generic CMD launcher and
  complete setup through browser authorization without downloading supporting
  files or manually changing PowerShell policy.
- Setup authorization is expiring, single-use, ownership-bound, rate-limited,
  replay-resistant, and audited.
- All requested scenes exist and switch manually.
- Optional hotkeys can be enabled or skipped.
- Dry-run, update-only, repair, reset, backup, rollback, and redacted logging
  behave as documented.
- A five-minute stream succeeds through MediaMTX and the site on the target
  Windows machine.

## Decisions currently accepted

- Use separate scenes rather than automatic game detection and switching.
- Make hotkeys optional.
- Require AV1 instead of configuring H.264.
- Do not silently use a software codec fallback.
- Preserve existing OBS configuration by default.
- Deliver one generic unsigned CMD launcher from `/account/channel`, with its
  exact SHA-256 checksum and an internally checksummed PowerShell payload.
- Use authenticated browser authorization instead of embedding or asking users
  to paste stream keys.

## Remaining release decisions

- Keep 12 Mbps after the first real 1440p60 stream or tune it for the available
  upload bandwidth and viewer count.
- Decide later whether broader distribution justifies a trusted Authenticode
  code-signing certificate. Version 1 remains reproducibly unsigned.
