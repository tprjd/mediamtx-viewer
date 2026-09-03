# Windows OBS setup

`setup-frankerzspam-obs.ps1` is the reviewed PowerShell payload. The site embeds
it in a deterministic `Setup-FrankerzSpam-OBS.cmd` launcher served to
authenticated streamers from `/account/channel`. Neither layer contains a
channel URL or publishing credential.

On Windows 10 or 11:

1. Download the CMD launcher from the channel page.
2. Compare its SHA-256 with the value shown beside the download.
3. Double-click it and accept the unsigned-publisher warning only if the
   checksum matched.
4. Sign in to the site when the browser opens and approve the displayed code.

The CMD layer extracts the embedded payload to a randomly named temporary file,
verifies its fixed SHA-256, unblocks that verified temporary copy, and starts it
with `RemoteSigned` for that child process only. It removes the temporary file
after setup. It does not use `ExecutionPolicy Bypass` or modify the user or
machine execution policy.

The default run installs or updates the exact `OBSProject.OBSStudio` WinGet
package, probes the hardware encoders that OBS actually reports, and creates a
managed profile for every requested codec and resolution it can encode. The
defaults request AV1, HEVC (H.265), and H.264 at 1440p and 1080p, producing up
to six 60 fps CBR profiles with two-second keyframes and Opus audio. The
keyframe interval comes from the canonical
[`streaming-contract.v1.json`](../../config/streaming-contract.v1.json).
NVIDIA AV1 profiles use two B-frames for better quality per bit; other
codec/vendor combinations retain zero B-frames:

- `FrankerzSpam 1440p60 AV1` — 2560×1440, 12 Mbps, the default/shortcut profile;
- `FrankerzSpam 1440p60 HEVC` — 2560×1440, 14 Mbps, limited browser support;
- `FrankerzSpam 1440p60 H264` — 2560×1440, 16 Mbps, broadest compatibility;
- `FrankerzSpam 1080p60 AV1` — 1920×1080, 8 Mbps;
- `FrankerzSpam 1080p60 HEVC` — 1920×1080, 9 Mbps;
- `FrankerzSpam 1080p60 H264` — 1920×1080, 10 Mbps.

All profiles use the shared scene collection's 2560×1440 base canvas. Scene
items use Area scaling, which gently prefilters a 4K game capture before it
reaches the 1440p canvas and is a no-op for a native 1440p source. The 1080p
profiles then downscale that canvas to 1920×1080 with Lanczos, so scene-item
positions and bounds remain correct when switching profiles.

Requested codecs whose hardware encoder OBS does not report are skipped after
confirmation; naming them explicitly with `-Codecs` makes the run fail before
any write. The same WHIP credential, the `FrankerzSpam Games` collection, and
the desktop shortcut (which launches the preferred profile) apply to every
managed profile:

- collection `FrankerzSpam Games` with separate Desktop, League of Legends,
  EVE Online, STALKER 2, Path of Exile, Path of Exile 2, and Generic Game scenes;
- WHIP service settings obtained through a single-use, ten-minute browser
  authorization.

`-Codecs` and `-Resolutions` narrow the matrix (for example
`-Codecs AV1,H264 -Resolutions 1080p`), and `-BitrateKbps` remains a
backward-compatible override for the 1440p60 AV1 profile only.

Each named game scene uses OBS Game Capture's `Capture any fullscreen
application` mode. This avoids fragile executable-only targets that OBS displays
as `(null)` and that stop working when a game changes its executable. Each scene
also includes a disabled Window Capture fallback. If Game Capture does not work,
start the game, select the fallback's window in OBS, then enable that source.

Setup version 1.4.0 recognizes collections created with the old executable-only
targets and upgrades the single AV1 profile from earlier versions: the existing
`FrankerzSpam 1440p60 AV1` profile is preserved when it is unchanged and
rebuilt (from a backup) when repair or reset is requested. A normal rerun offers
to back up and rebuild the managed collection; unrelated OBS profiles and
collections remain untouched.

Existing managed configurations are intentionally preserved on an ordinary
rerun. Use `-RepairManagedConfig` to apply the contract's two-second GOP and
current encoder defaults to existing profiles. Use `-ResetManagedConfig` to also
recreate the managed scene collection with Area scaling. Setup backs up the
managed files and asks for confirmation first.

Existing unrelated profiles and collections are untouched. A normal rerun
preserves the managed scenes and profile. The supported maintenance modes are:

```powershell
.\Setup-FrankerzSpam-OBS.cmd -UpdateOnly
.\Setup-FrankerzSpam-OBS.cmd -RepairManagedConfig
.\Setup-FrankerzSpam-OBS.cmd -ResetManagedConfig
.\Setup-FrankerzSpam-OBS.cmd -DryRun
```

Repair and reset ask before changing existing managed files and back them up
without copying `service.json`, so publishing credentials are not duplicated.
Version 1 is intentionally unsigned; signing a future executable or installer
can improve Windows trust prompts without changing the device-authorization
design.
