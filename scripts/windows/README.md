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
package, requires a hardware AV1 encoder reported by OBS, and creates:

- profile `FrankerzSpam 1440p60 AV1` at 2560×1440, 60 fps, 12 Mbps CBR, two-second
  keyframes, zero B-frames, and Opus audio;
- collection `FrankerzSpam Games` with separate Desktop, League of Legends,
  EVE Online, STALKER 2, Path of Exile, Path of Exile 2, and Generic Game scenes;
- WHIP service settings obtained through a single-use, ten-minute browser
  authorization.

Each named game scene uses OBS Game Capture's `Capture any fullscreen
application` mode. This avoids fragile executable-only targets that OBS displays
as `(null)` and that stop working when a game changes its executable. Each scene
also includes a disabled Window Capture fallback. If Game Capture does not work,
start the game, select the fallback's window in OBS, then enable that source.

Setup version 1.0.3 recognizes collections created with the old executable-only
targets. A normal rerun offers to back up and rebuild that managed collection;
unrelated OBS profiles and collections remain untouched.

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
