# Windows OBS setup

`setup-frankerzspam-obs.ps1` is the generic script served to authenticated
streamers from `/account/channel`. It contains no channel URL or publishing
credential.

On Windows 10 or 11:

1. Download the script from the channel page.
2. Compare its SHA-256 with the value shown beside the download.
3. Right-click the file, open **Properties**, and select **Unblock** if present.
4. Right-click it and choose **Run with PowerShell**. On Windows 11 this may be
   under **Show more options**.
5. Sign in to the site when the browser opens and approve the displayed code.

The default run installs or updates the exact `OBSProject.OBSStudio` WinGet
package, requires a hardware AV1 encoder reported by OBS, and creates:

- profile `FrankerzSpam 1440p60 AV1` at 2560×1440, 60 fps, 12 Mbps CBR, two-second
  keyframes, zero B-frames, and Opus audio;
- collection `FrankerzSpam Games` with separate Desktop, League of Legends,
  EVE Online, STALKER 2, Path of Exile, Path of Exile 2, and Generic Game scenes;
- WHIP service settings obtained through a single-use, ten-minute browser
  authorization.

Existing unrelated profiles and collections are untouched. A normal rerun
preserves the managed scenes and profile. The supported maintenance modes are:

```powershell
.\Setup-FrankerzSpam-OBS.ps1 -UpdateOnly
.\Setup-FrankerzSpam-OBS.ps1 -RepairManagedConfig
.\Setup-FrankerzSpam-OBS.ps1 -ResetManagedConfig
.\Setup-FrankerzSpam-OBS.ps1 -DryRun
```

Repair and reset ask before changing existing managed files and back them up
without copying `service.json`, so publishing credentials are not duplicated.
Version 1 is intentionally unsigned; Authenticode signing can be added later
without changing the device-authorization design.
