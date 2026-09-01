# FrankerzSpam OBS setup for Windows 10/11.
# Download the latest copy from your authenticated channel page.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$UpdateOnly,
    [switch]$RepairManagedConfig,
    [switch]$ResetManagedConfig,
    [ValidateRange(8000, 20000)]
    [int]$BitrateKbps = 12000,
    [string]$Codecs = 'AV1,HEVC,H264',
    [string]$Resolutions = '1440p,1080p',
    [string]$SiteOrigin = 'https://frankerzspam.duckdns.org'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptVersion = '1.2.0'
$CollectionName = 'FrankerzSpam Games'
$CollectionFileName = 'FrankerzSpam_Games.json'
$ObsPackageId = 'OBSProject.OBSStudio'
$SceneCanvasWidth = 2560
$SceneCanvasHeight = 1440

# Managed profile matrix. Every profile uses the shared scene collection's
# 2560x1440 canvas; Width and Height are the stream output dimensions. The
# 1080p profiles therefore downscale the common canvas with Lanczos. Scene
# items use Area scaling so a 4K capture is gently prefiltered before the
# shared 1440p canvas is encoded; native 1440p captures remain unscaled.
# LaunchPriority picks the shortcut/default profile: 1440p60 AV1 first, then
# 1080p60 H.264, then the first matrix entry managed by this run.
$ManagedProfiles = @(
    [pscustomobject]@{
        Key = '1440p60-av1'
        Name = 'FrankerzSpam 1440p60 AV1'
        DirectoryName = 'FrankerzSpam_1440p60_AV1'
        Codec = 'AV1'
        Resolution = '1440p'
        Width = 2560
        Height = 1440
        DefaultBitrateKbps = 12000
        Compatibility = 'Best quality-per-bit; current default'
        LaunchPriority = 1
    },
    [pscustomobject]@{
        Key = '1440p60-hevc'
        Name = 'FrankerzSpam 1440p60 HEVC'
        DirectoryName = 'FrankerzSpam_1440p60_HEVC'
        Codec = 'HEVC'
        Resolution = '1440p'
        Width = 2560
        Height = 1440
        DefaultBitrateKbps = 14000
        Compatibility = 'Experimental; limited browser compatibility'
        LaunchPriority = 3
    },
    [pscustomobject]@{
        Key = '1440p60-h264'
        Name = 'FrankerzSpam 1440p60 H264'
        DirectoryName = 'FrankerzSpam_1440p60_H264'
        Codec = 'H264'
        Resolution = '1440p'
        Width = 2560
        Height = 1440
        DefaultBitrateKbps = 16000
        Compatibility = 'Broad compatibility, higher bandwidth'
        LaunchPriority = 3
    },
    [pscustomobject]@{
        Key = '1080p60-av1'
        Name = 'FrankerzSpam 1080p60 AV1'
        DirectoryName = 'FrankerzSpam_1080p60_AV1'
        Codec = 'AV1'
        Resolution = '1080p'
        Width = 1920
        Height = 1080
        DefaultBitrateKbps = 8000
        Compatibility = 'Efficient lower-bandwidth option'
        LaunchPriority = 3
    },
    [pscustomobject]@{
        Key = '1080p60-hevc'
        Name = 'FrankerzSpam 1080p60 HEVC'
        DirectoryName = 'FrankerzSpam_1080p60_HEVC'
        Codec = 'HEVC'
        Resolution = '1080p'
        Width = 1920
        Height = 1080
        DefaultBitrateKbps = 9000
        Compatibility = 'Experimental; limited browser compatibility'
        LaunchPriority = 3
    },
    [pscustomobject]@{
        Key = '1080p60-h264'
        Name = 'FrankerzSpam 1080p60 H264'
        DirectoryName = 'FrankerzSpam_1080p60_H264'
        Codec = 'H264'
        Resolution = '1080p'
        Width = 1920
        Height = 1080
        DefaultBitrateKbps = 10000
        Compatibility = 'Recommended compatibility option'
        LaunchPriority = 2
    }
)

# Hardware encoder identifiers verified against the OBS 31/32 sources
# (plugins/obs-nvenc, plugins/obs-ffmpeg/texture-amf, and plugins/obs-qsv11).
# OBS 30 removed the old enc-amf plugin, but its texture-based AMF replacement
# remains supported. Vendor preference matches the original setup behavior.
$EncoderVendorOrder = @('NVIDIA', 'AMD', 'Intel')
$EncoderAllowlists = [ordered]@{
    AV1 = [ordered]@{
        NVIDIA = @('obs_nvenc_av1_tex')
        AMD = @('av1_texture_amf')
        Intel = @('obs_qsv11_av1')
    }
    HEVC = [ordered]@{
        NVIDIA = @('obs_nvenc_hevc_tex')
        AMD = @('h265_texture_amf')
        Intel = @('obs_qsv11_hevc')
    }
    H264 = [ordered]@{
        NVIDIA = @('obs_nvenc_h264_tex')
        AMD = @('h264_texture_amf')
        Intel = @('obs_qsv11_v2', 'obs_qsv11')
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Info {
    param([string]$Message)
    Write-Host "    $Message"
}

function Read-Confirmation {
    param(
        [string]$Prompt,
        [bool]$Default = $true
    )
    $suffix = if ($Default) { '[Y/n]' } else { '[y/N]' }
    $answer = Read-Host "$Prompt $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim().ToLowerInvariant().StartsWith('y')
}

function Assert-SupportedHost {
    if ($PSVersionTable.PSVersion -lt [Version]'5.1') {
        throw 'PowerShell 5.1 or newer is required.'
    }
    if ($env:OS -ne 'Windows_NT') {
        throw 'This script supports Windows 10 and Windows 11 only.'
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'A 64-bit Windows installation is required.'
    }
    $version = [Environment]::OSVersion.Version
    if ($version.Major -lt 10) {
        throw 'Windows 10 or Windows 11 is required.'
    }
    $origin = $null
    if (-not [Uri]::TryCreate($SiteOrigin, [UriKind]::Absolute, [ref]$origin)) {
        throw 'SiteOrigin must be an absolute URL.'
    }
    $local = $origin.Host -in @('localhost', '127.0.0.1', '::1')
    if ($origin.Scheme -ne 'https' -and -not $local) {
        throw 'SiteOrigin must use HTTPS.'
    }
    $script:SiteOrigin = $origin.GetLeftPart([UriPartial]::Authority).TrimEnd('/')
}

function Assert-SupportedObsVersion {
    param([string]$ObsExecutable)

    $productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($ObsExecutable).ProductVersion
    if (-not $productVersion -or $productVersion -notmatch '^(?<major>\d+)\.') {
        throw 'The installed OBS Studio version could not be identified.'
    }
    $majorVersion = [int]$Matches.major
    if ($majorVersion -notin @(31, 32)) {
        throw "OBS Studio $productVersion has not been validated with setup v$ScriptVersion. Use -UpdateOnly or download a newer setup script."
    }
    Write-Info "OBS Studio $productVersion is supported."
}

function Assert-ExclusiveModes {
    $selected = @(
        @($UpdateOnly, $RepairManagedConfig, $ResetManagedConfig) |
            Where-Object { $_ }
    )
    if ($selected.Count -gt 1) {
        throw 'Use only one of UpdateOnly, RepairManagedConfig, or ResetManagedConfig.'
    }
}

function Get-CodecSelection {
    param([string]$Value)
    $allowed = @('AV1', 'HEVC', 'H264')
    $selected = @()
    foreach ($token in ($Value -split ',')) {
        $codec = $token.Trim().ToUpperInvariant()
        if ($codec -eq '') { continue }
        if ($codec -notin $allowed) {
            throw "Unknown codec '$token'. -Codecs accepts a comma-separated list of: AV1, HEVC, H264."
        }
        if ($selected -notcontains $codec) { $selected += $codec }
    }
    if ($selected.Count -eq 0) {
        throw '-Codecs must include at least one of: AV1, HEVC, H264.'
    }
    return $selected
}

function Get-ResolutionSelection {
    param([string]$Value)
    $allowed = @('1440p', '1080p')
    $selected = @()
    foreach ($token in ($Value -split ',')) {
        $resolution = $token.Trim().ToLowerInvariant()
        if ($resolution -eq '') { continue }
        if ($resolution -notin $allowed) {
            throw "Unknown resolution '$token'. -Resolutions accepts a comma-separated list of: 1440p, 1080p."
        }
        if ($selected -notcontains $resolution) { $selected += $resolution }
    }
    if ($selected.Count -eq 0) {
        throw '-Resolutions must include at least one of: 1440p, 1080p.'
    }
    return $selected
}

function Get-WinGetCommand {
    $command = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw 'WinGet is required. Install App Installer from Microsoft Store, then run this script again.'
    }
    return $command.Source
}

function Invoke-ObsInstallOrUpdate {
    param([string]$WinGet)

    $listOutput = & $WinGet list --id $ObsPackageId --exact --accept-source-agreements 2>&1 |
        Out-String
    $installed = $listOutput -match [regex]::Escape($ObsPackageId)
    if ($DryRun) {
        Write-Info $(if ($installed) { 'Would check OBS Studio for updates.' } else { 'Would install OBS Studio.' })
        return
    }

    if ($installed) {
        Write-Info 'Checking OBS Studio for updates through WinGet.'
        & $WinGet upgrade --id $ObsPackageId --exact --silent `
            --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -notin @(0, -1978335189)) {
            throw "WinGet could not update OBS Studio (exit code $LASTEXITCODE)."
        }
    } else {
        Write-Info 'Installing OBS Studio through WinGet.'
        & $WinGet install --id $ObsPackageId --exact --silent `
            --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "WinGet could not install OBS Studio (exit code $LASTEXITCODE)."
        }
    }
}

function Get-ObsExecutable {
    $candidatePaths = @(
        (Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\obs-studio\bin\64bit\obs64.exe')
    )
    $programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
    if ($programFilesX86) {
        $candidatePaths += Join-Path $programFilesX86 'obs-studio\bin\64bit\obs64.exe'
    }
    $candidates = @($candidatePaths | Where-Object { Test-Path -LiteralPath $_ })
    if ($candidates.Count -eq 0) {
        throw 'OBS Studio was not found after installation.'
    }
    return $candidates[0]
}

function Assert-ObsClosed {
    $running = Get-Process obs64 -ErrorAction SilentlyContinue
    if (-not $running) { return }
    Write-Info 'OBS Studio must be closed before its profiles are changed.'
    if (-not (Read-Confirmation 'Close OBS and continue when it has exited?' $true)) {
        throw 'Setup cancelled because OBS Studio is running.'
    }
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if (-not (Get-Process obs64 -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    throw 'OBS Studio is still running. Close it and run setup again.'
}

function Get-EncoderCapabilityMap {
    param(
        [string]$LogsDirectory,
        [datetime]$Since = [datetime]::MinValue
    )
    $capabilities = [ordered]@{
        AV1 = $null
        HEVC = $null
        H264 = $null
    }
    if (-not (Test-Path -LiteralPath $LogsDirectory)) { return $capabilities }
    $logs = @(
        Get-ChildItem -LiteralPath $LogsDirectory -Filter '*.txt' -File |
            Where-Object { $_.LastWriteTime -ge $Since } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 5
    )
    if ($logs.Count -eq 0) { return $capabilities }
    $logText = @()
    foreach ($log in $logs) {
        $logText += Get-Content -LiteralPath $log.FullName -Raw -ErrorAction SilentlyContinue
    }
    $logText = $logText -join "`n"
    if (-not $logText) { return $capabilities }
    foreach ($codec in @('AV1', 'HEVC', 'H264')) {
        foreach ($vendor in $EncoderVendorOrder) {
            foreach ($encoderId in $EncoderAllowlists[$codec][$vendor]) {
                if ($logText -like "*- $encoderId (*") {
                    $capabilities[$codec] = [pscustomobject]@{
                        Vendor = $vendor
                        EncoderId = $encoderId
                    }
                    break
                }
            }
            if ($capabilities[$codec]) { break }
        }
    }
    return $capabilities
}

function Get-HardwareEncoderCapabilities {
    param(
        [string]$ObsExecutable,
        [string]$LogsDirectory,
        [string[]]$CodecsToFind
    )

    if ($DryRun) { return Get-EncoderCapabilityMap $LogsDirectory }

    Write-Info 'Launching OBS briefly to read its hardware encoder inventory.'
    $probeStartedAt = (Get-Date).AddSeconds(-2)
    $workingDirectory = Split-Path -Parent $ObsExecutable
    $probe = Start-Process -FilePath $ObsExecutable -WorkingDirectory $workingDirectory `
        -ArgumentList '--minimize-to-tray', '--disable-shutdown-check' -PassThru
    $capabilities = $null
    try {
        for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
            Start-Sleep -Seconds 1
            $capabilities = Get-EncoderCapabilityMap $LogsDirectory $probeStartedAt
            $allFound = $true
            foreach ($codec in $CodecsToFind) {
                if (-not $capabilities[$codec]) { $allFound = $false; break }
            }
            if ($allFound) { break }
            if ($probe.HasExited) { break }
        }
    } finally {
        if (-not $probe.HasExited) {
            [void]$probe.CloseMainWindow()
            if (-not $probe.WaitForExit(5000)) {
                Stop-Process -Id $probe.Id -Force
            }
        }
    }
    if (-not $capabilities) {
        $capabilities = Get-EncoderCapabilityMap $LogsDirectory $probeStartedAt
    }
    return $capabilities
}

function Show-EncoderCapabilities {
    param(
        $Capabilities,
        [string[]]$Codecs,
        [bool]$Probed
    )
    Write-Info 'Hardware encoder capability summary:'
    foreach ($codec in $Codecs) {
        $capability = $Capabilities[$codec]
        if ($capability) {
            Write-Info "  $codec : $($capability.Vendor) ($($capability.EncoderId))"
        }
        elseif ($Probed) {
            Write-Info "  $codec : no supported hardware encoder in the OBS inventory"
        }
        else {
            Write-Info "  $codec : not verified yet (no recent OBS logs found)"
        }
    }
}

function Resolve-ManagedSelection {
    param(
        [string[]]$RequestedCodecs,
        [string[]]$RequestedResolutions,
        $Capabilities,
        [bool]$Probed,
        [bool]$CodecsExplicit
    )
    $selected = @()
    $skipped = @()
    foreach ($codec in $RequestedCodecs) {
        $capability = $Capabilities[$codec]
        if ($capability) {
            foreach ($resolution in $RequestedResolutions) {
                $profile = $ManagedProfiles |
                    Where-Object { $_.Codec -eq $codec -and $_.Resolution -eq $resolution } |
                    Select-Object -First 1
                $profile | Add-Member -NotePropertyName Encoder `
                    -NotePropertyValue $capability -Force
                $bitrate = $profile.DefaultBitrateKbps
                if ($profile.Key -eq '1440p60-av1') {
                    # -BitrateKbps remains a backward-compatible override for
                    # the 1440p60 AV1 profile only.
                    $bitrate = $BitrateKbps
                }
                $profile | Add-Member -NotePropertyName BitrateKbps `
                    -NotePropertyValue $bitrate -Force
                $selected += $profile
            }
        }
        elseif ($Probed) {
            $skipped += [pscustomobject]@{
                Codec = $codec
                Reason = 'No supported hardware encoder in the OBS encoder inventory.'
            }
        }
    }
    if ($skipped.Count -gt 0) {
        foreach ($skip in $skipped) {
            Write-Info "Skipped $($skip.Codec): $($skip.Reason)"
        }
        if ($CodecsExplicit) {
            $names = ($skipped | ForEach-Object { $_.Codec }) -join ', '
            throw "Requested codec(s) $names have no supported hardware encoder. Update the GPU driver or choose available codecs with -Codecs."
        }
    }
    if ($selected.Count -eq 0 -and $Probed) {
        throw 'OBS did not report a supported hardware video encoder for AV1, HEVC, or H.264. Update the GPU driver or use a supported GPU.'
    }
    return [pscustomobject]@{
        Profiles = $selected
        Skipped = $skipped
    }
}

function Get-Utf8NoBomEncoding {
    return New-Object System.Text.UTF8Encoding($false)
}

function Write-AtomicText {
    param(
        [string]$Path,
        [string]$Content
    )
    $directory = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $operationId = [Guid]::NewGuid().ToString('N')
    $temporaryPath = "$Path.$operationId.tmp"
    $replacementBackupPath = "$Path.$operationId.replace-backup"
    try {
        [IO.File]::WriteAllText($temporaryPath, $Content, (Get-Utf8NoBomEncoding))
        if (Test-Path -LiteralPath $Path) {
            [IO.File]::Replace(
                $temporaryPath,
                $Path,
                $replacementBackupPath,
                $true
            )
            [IO.File]::Delete($replacementBackupPath)
        } else {
            [IO.File]::Move($temporaryPath, $Path)
        }
    } catch {
        $writeError = $_
        if ((Test-Path -LiteralPath $replacementBackupPath) -and
            -not (Test-Path -LiteralPath $Path)) {
            [IO.File]::Move($replacementBackupPath, $Path)
        }
        throw $writeError
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if ((Test-Path -LiteralPath $replacementBackupPath) -and
            (Test-Path -LiteralPath $Path)) {
            Remove-Item -LiteralPath $replacementBackupPath -Force
        }
    }
}

function Backup-ManagedConfiguration {
    param(
        [string[]]$ProfileDirectories,
        [string]$CollectionPath
    )
    $existingProfiles = @($ProfileDirectories | Where-Object { Test-Path -LiteralPath $_ })
    $collectionExists = Test-Path -LiteralPath $CollectionPath
    if ($existingProfiles.Count -eq 0 -and -not $collectionExists) { return }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path $env:LOCALAPPDATA "FrankerzSpam\OBS Backups\$timestamp"
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    foreach ($profileDirectory in $existingProfiles) {
        $profileBackup = Join-Path $backupRoot (Split-Path -Leaf $profileDirectory)
        [IO.Directory]::CreateDirectory($profileBackup) | Out-Null
        foreach ($name in @('basic.ini', 'streamEncoder.json')) {
            $source = Join-Path $profileDirectory $name
            if (Test-Path -LiteralPath $source) {
                Copy-Item -LiteralPath $source -Destination $profileBackup
            }
        }
    }
    if ($collectionExists) {
        Copy-Item -LiteralPath $CollectionPath -Destination $backupRoot
    }
    Write-Info "Managed configuration backed up to $backupRoot"
}

function Test-LegacyExecutableOnlyCaptureTargets {
    param([string]$CollectionPath)
    if (-not (Test-Path -LiteralPath $CollectionPath)) { return $false }

    try {
        $collectionJson = [IO.File]::ReadAllText($CollectionPath)
        return $collectionJson -match '"capture_mode"\s*:\s*"window"' -and
            $collectionJson -match '"window"\s*:\s*"::'
    } catch {
        Write-Warning "Could not inspect the existing managed scene collection: $($_.Exception.Message)"
        return $false
    }
}

function Get-EncoderSettings {
    param($Profile)
    $settings = [ordered]@{
        rate_control = 'CBR'
        bitrate = $Profile.BitrateKbps
        keyint_sec = 2
        bf = 0
    }
    $vendor = $Profile.Encoder.Vendor
    $codec = $Profile.Codec
    if ($vendor -eq 'NVIDIA') {
        # OBS 31+ NVENC property names (plugins/obs-nvenc/nvenc-properties.c):
        # preset p1-p7, tune, multipass, lookahead, adaptive_quantization.
        $settings.preset = 'p5'
        $settings.tune = 'hq'
        $settings.multipass = 'qres'
        $settings.lookahead = $false
        $settings.adaptive_quantization = $true
        if ($codec -eq 'AV1') {
            # OBS's normal NVENC baseline uses two B-frames. They improve
            # quality per bit with little encoder cost; the two-second GOP
            # remains suitable for both buffered HLS and optional WebRTC.
            $settings.bf = 2
        }
        if ($codec -eq 'H264') {
            # Baseline keeps the H.264 stream WebRTC-friendly.
            $settings.profile = 'baseline'
        }
        else {
            # Main profile, 8-bit 4:2:0 output. Main10/HDR is out of scope.
            $settings.profile = 'main'
        }
    }
    elseif ($vendor -eq 'AMD') {
        # OBS 31+ texture-AMF property names. AV1 has a single Main profile;
        # HEVC defaults to Main, while H.264 is pinned to Baseline for WebRTC.
        $settings.preset = 'quality'
        if ($codec -eq 'H264') {
            $settings.profile = 'baseline'
        }
        elseif ($codec -eq 'HEVC') {
            $settings.profile = 'main'
        }
    }
    elseif ($vendor -eq 'Intel') {
        # QSV quality knob is target_usage (TU1-TU7); 'balanced' is migrated
        # to TU4 by the plugin (plugins/obs-qsv11/obs-qsv11.c).
        $settings.target_usage = 'balanced'
        if ($codec -eq 'H264') {
            $settings.profile = 'baseline'
        }
        elseif ($codec -eq 'HEVC') {
            $settings.profile = 'main'
        }
    }
    return $settings
}

function Write-ManagedProfile {
    param(
        [string]$ProfileDirectory,
        $Profile
    )
    [IO.Directory]::CreateDirectory($ProfileDirectory) | Out-Null
    $videosPath = [Environment]::GetFolderPath('MyVideos')
    $basicIni = @"
[General]
Name=$($Profile.Name)

[Output]
Mode=Advanced
FilenameFormatting=%CCYY-%MM-%DD %hh-%mm-%ss
Reconnect=true
RetryDelay=2
MaxRetries=25
BindIP=default
IPFamily=IPv4+IPv6
LowLatencyEnable=true

[Stream1]
IgnoreRecommended=true
EnableMultitrackVideo=false
WHIPSimulcastTotalLayers=1

[AdvOut]
ApplyServiceSettings=true
UseRescale=false
TrackIndex=1
Encoder=$($Profile.Encoder.EncoderId)
AudioEncoder=ffmpeg_opus
Track1Bitrate=160
RecType=Standard
RecFilePath=$videosPath
RecFormat2=mkv
RecUseRescale=false
RecTracks=1

[Video]
BaseCX=$SceneCanvasWidth
BaseCY=$SceneCanvasHeight
OutputCX=$($Profile.Width)
OutputCY=$($Profile.Height)
FPSType=0
FPSCommon=60
ScaleType=lanczos
ColorFormat=NV12
ColorSpace=709
ColorRange=Partial
SdrWhiteLevel=300
HdrNominalPeakLevel=1000

[Audio]
MonitoringDeviceId=default
MonitoringDeviceName=Default
SampleRate=48000
ChannelSetup=Stereo
"@
    Write-AtomicText (Join-Path $ProfileDirectory 'basic.ini') $basicIni
    $encoderJson = Get-EncoderSettings $Profile |
        ConvertTo-Json -Depth 10
    Write-AtomicText (Join-Path $ProfileDirectory 'streamEncoder.json') $encoderJson
}

function New-ObsInputSource {
    param(
        [string]$Name,
        [string]$Id,
        [System.Collections.IDictionary]$Settings,
        [bool]$Muted = $false
    )
    return [ordered]@{
        name = $Name
        uuid = [Guid]::NewGuid().ToString()
        id = $Id
        versioned_id = $Id
        settings = $Settings
        mixers = 255
        sync = 0
        flags = 0
        volume = 1.0
        balance = 0.5
        enabled = $true
        muted = $Muted
        'push-to-mute' = $false
        'push-to-mute-delay' = 0
        'push-to-talk' = $false
        'push-to-talk-delay' = 0
        hotkeys = [ordered]@{}
        deinterlace_mode = 0
        deinterlace_field_order = 0
        monitoring_type = 0
        private_settings = [ordered]@{}
    }
}

function New-SceneItem {
    param(
        [System.Collections.IDictionary]$Source,
        [int]$Id,
        [bool]$Visible = $true
    )
    return [ordered]@{
        name = $Source.name
        source_uuid = $Source.uuid
        visible = $Visible
        locked = $false
        rot = 0.0
        pos = [ordered]@{ x = 0.0; y = 0.0 }
        scale = [ordered]@{ x = 1.0; y = 1.0 }
        align = 5
        bounds_type = 2
        bounds_align = 0
        bounds = [ordered]@{
            x = [double]$SceneCanvasWidth
            y = [double]$SceneCanvasHeight
        }
        crop_left = 0
        crop_top = 0
        crop_right = 0
        crop_bottom = 0
        id = $Id
        group_item_backup = $false
        # Area reduces subpixel shimmer and high-frequency foliage before a
        # 4K source reaches the 1440p canvas. At native canvas size it is a
        # no-op, so the same collection works for 1440p and 4K games.
        scale_filter = 'area'
        blend_method = 'default'
        blend_type = 'normal'
        show_transition = [ordered]@{ duration = 0 }
        hide_transition = [ordered]@{ duration = 0 }
        private_settings = [ordered]@{}
    }
}

function New-SceneSource {
    param(
        [string]$Name,
        [object[]]$Items,
        [string]$Hotkey = ''
    )
    $hotkeys = [ordered]@{}
    if ($Hotkey) {
        $hotkeys['OBSBasic.SelectScene'] = @(
            [ordered]@{ control = $true; alt = $true; key = $Hotkey }
        )
    }
    return [ordered]@{
        name = $Name
        uuid = [Guid]::NewGuid().ToString()
        id = 'scene'
        versioned_id = 'scene'
        settings = [ordered]@{
            id_counter = @($Items).Count
            custom_size = $false
            items = $Items
        }
        mixers = 0
        sync = 0
        flags = 0
        volume = 1.0
        balance = 0.5
        enabled = $true
        muted = $false
        'push-to-mute' = $false
        'push-to-mute-delay' = 0
        'push-to-talk' = $false
        'push-to-talk-delay' = 0
        hotkeys = $hotkeys
        deinterlace_mode = 0
        deinterlace_field_order = 0
        monitoring_type = 0
        private_settings = [ordered]@{}
    }
}

function Write-ManagedSceneCollection {
    param(
        [string]$CollectionPath,
        [bool]$EnableMicrophone,
        [bool]$EnableHotkeys
    )
    Add-Type -AssemblyName System.Windows.Forms
    $screens = @([Windows.Forms.Screen]::AllScreens)
    $primaryIndex = 0
    for ($index = 0; $index -lt $screens.Count; $index += 1) {
        if ($screens[$index].Primary) { $primaryIndex = $index; break }
    }

    $gameDefinitions = @(
        [ordered]@{
            Name = 'League of Legends'
            Hotkey = 'OBS_KEY_2'
        },
        [ordered]@{
            Name = 'EVE Online'
            Hotkey = 'OBS_KEY_3'
        },
        [ordered]@{
            Name = 'STALKER 2'
            Hotkey = 'OBS_KEY_4'
        },
        [ordered]@{
            Name = 'Path of Exile'
            Hotkey = 'OBS_KEY_5'
        },
        [ordered]@{
            Name = 'Path of Exile 2'
            Hotkey = 'OBS_KEY_6'
        }
    )

    $sources = New-Object System.Collections.ArrayList
    $scenes = New-Object System.Collections.ArrayList
    $sceneOrder = New-Object System.Collections.ArrayList

    $desktop = New-ObsInputSource 'Primary display' 'monitor_capture' ([ordered]@{
        monitor = $primaryIndex
        capture_cursor = $true
        method = 0
    })
    [void]$sources.Add($desktop)
    $desktopScene = New-SceneSource 'Desktop' @((New-SceneItem $desktop 1 $true)) `
        $(if ($EnableHotkeys) { 'OBS_KEY_1' } else { '' })
    [void]$scenes.Add($desktopScene)
    [void]$sceneOrder.Add([ordered]@{ name = 'Desktop' })

    foreach ($game in $gameDefinitions) {
        $gameSource = New-ObsInputSource "$($game.Name) - Game Capture" 'game_capture' ([ordered]@{
            capture_mode = 'any_fullscreen'
            capture_cursor = $true
            anti_cheat_hook = $true
            limit_framerate = $false
        })
        $windowSource = New-ObsInputSource "$($game.Name) - Window fallback (select while running)" 'window_capture' ([ordered]@{
            window = ''
            priority = 2
            method = 2
            cursor = $true
            client_area = $true
        })
        [void]$sources.Add($gameSource)
        [void]$sources.Add($windowSource)
        $items = @(
            (New-SceneItem $windowSource 1 $false),
            (New-SceneItem $gameSource 2 $true)
        )
        $scene = New-SceneSource $game.Name $items `
            $(if ($EnableHotkeys) { $game.Hotkey } else { '' })
        [void]$scenes.Add($scene)
        [void]$sceneOrder.Add([ordered]@{ name = $game.Name })
    }

    $generic = New-ObsInputSource 'Any fullscreen game' 'game_capture' ([ordered]@{
        capture_mode = 'any_fullscreen'
        capture_cursor = $true
        anti_cheat_hook = $true
        limit_framerate = $false
    })
    [void]$sources.Add($generic)
    $genericScene = New-SceneSource 'Generic Game' @((New-SceneItem $generic 1 $true)) `
        $(if ($EnableHotkeys) { 'OBS_KEY_0' } else { '' })
    [void]$scenes.Add($genericScene)
    [void]$sceneOrder.Add([ordered]@{ name = 'Generic Game' })

    foreach ($scene in $scenes) { [void]$sources.Add($scene) }
    $desktopAudio = New-ObsInputSource 'Desktop Audio' 'wasapi_output_capture' ([ordered]@{
        device_id = 'default'
        use_device_timing = $true
    })
    $microphone = if ($EnableMicrophone) {
        New-ObsInputSource 'Mic/Aux' 'wasapi_input_capture' ([ordered]@{
            device_id = 'default'
            use_device_timing = $false
        })
    } else { $null }

    $collection = [ordered]@{
        DesktopAudioDevice1 = $desktopAudio
        current_scene = 'Desktop'
        current_program_scene = 'Desktop'
        scene_order = @($sceneOrder)
        name = $CollectionName
        groups = @()
        quick_transitions = @(
            [ordered]@{ name = 'Cut'; duration = 300; hotkeys = @(); id = 1; fade_to_black = $false },
            [ordered]@{ name = 'Fade'; duration = 300; hotkeys = @(); id = 2; fade_to_black = $false }
        )
        transitions = @()
        saved_projectors = @()
        current_transition = 'Fade'
        transition_duration = 300
        preview_locked = $false
        scaling_enabled = $false
        scaling_level = 0
        scaling_off_x = 0.0
        scaling_off_y = 0.0
        modules = [ordered]@{
            'auto-scene-switcher' = [ordered]@{
                interval = 300
                non_matching_scene = ''
                switch_if_not_matching = $false
                active = $false
                switches = @()
            }
        }
        sources = @($sources)
    }
    if ($microphone) { $collection['AuxAudioDevice1'] = $microphone }
    Write-AtomicText $CollectionPath ($collection | ConvertTo-Json -Depth 30)
}

function Start-DeviceAuthorization {
    $startBody = @{ scriptVersion = $ScriptVersion } | ConvertTo-Json -Compress
    $session = Invoke-RestMethod -Method Post `
        -Uri "$SiteOrigin/api/obs-setup/device/start" `
        -ContentType 'application/json' -Body $startBody
    if (-not $session.deviceSecret -or -not $session.verificationUrl) {
        throw 'The site returned an invalid OBS setup session.'
    }

    Write-Host "`nAuthorize code $($session.userCode) in your browser." -ForegroundColor Yellow
    Start-Process $session.verificationUrl
    $deadline = (Get-Date).AddSeconds([int]$session.expiresIn)
    $interval = [Math]::Max(3, [int]$session.interval)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $interval
        try {
            $pollBody = @{ deviceSecret = $session.deviceSecret } |
                ConvertTo-Json -Compress
            $result = Invoke-RestMethod -Method Post `
                -Uri "$SiteOrigin/api/obs-setup/device/poll" `
                -ContentType 'application/json' -Body $pollBody
            if ($result.status -eq 'authorized') {
                return $result
            }
            if ($result.status -ne 'pending') {
                throw "OBS setup ended with status '$($result.status)'."
            }
        } catch {
            $response = $_.Exception.Response
            if ($response -and [int]$response.StatusCode -eq 429) {
                Start-Sleep -Seconds $interval
                continue
            }
            throw
        }
    }
    throw 'The ten-minute OBS authorization window expired. Run the script again.'
}

function Write-WhipService {
    param(
        [string[]]$ProfileDirectories,
        [string]$ServerUrl,
        [string]$BearerToken
    )
    if (-not $ServerUrl.StartsWith("$SiteOrigin/publish/whip/")) {
        throw 'The site returned an unexpected WHIP server URL.'
    }
    if (-not $BearerToken.StartsWith('mtx_sk_') -or $BearerToken.Length -lt 48) {
        throw 'The site returned an invalid OBS publishing credential.'
    }
    $targets = @($ProfileDirectories | Where-Object { Test-Path -LiteralPath $_ })
    if ($targets.Count -eq 0) {
        throw 'No managed OBS profiles were available to receive the publishing settings.'
    }
    $service = [ordered]@{
        type = 'whip_custom'
        settings = [ordered]@{
            service = 'WHIP'
            server = $ServerUrl
            bearer_token = $BearerToken
        }
        hotkeys = [ordered]@{}
    } | ConvertTo-Json -Depth 10
    $updatedDirectories = @()
    foreach ($profileDirectory in $targets) {
        try {
            Write-AtomicText (Join-Path $profileDirectory 'service.json') $service
            $updatedDirectories += $profileDirectory
        } catch {
            $writeError = $_
            $updatedNames = @($updatedDirectories | ForEach-Object { Split-Path -Leaf $_ }) -join ', '
            $pendingNames = @($targets |
                Where-Object { $_ -notin $updatedDirectories } |
                ForEach-Object { Split-Path -Leaf $_ }) -join ', '
            $summary = if ($updatedNames) { "Updated: $updatedNames. " } else { '' }
            $summary += "Not updated: $pendingNames. Rerun setup to rotate the credential again."
            throw "$summary Original error: $($writeError.Exception.Message)"
        }
    }
}

function New-DesktopShortcut {
    param(
        [string]$ObsExecutable,
        [string]$ProfileName
    )
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'FrankerzSpam OBS.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $ObsExecutable
    $shortcut.WorkingDirectory = Split-Path -Parent $ObsExecutable
    $shortcut.Arguments = "--profile `"$ProfileName`" --collection `"$CollectionName`""
    $shortcut.IconLocation = "$ObsExecutable,0"
    $shortcut.Save()
}

try {
    Assert-SupportedHost
    Assert-ExclusiveModes
    $requestedCodecs = Get-CodecSelection $Codecs
    $requestedResolutions = Get-ResolutionSelection $Resolutions
    $codecsExplicit = $MyInvocation.BoundParameters.ContainsKey('Codecs')
    Write-Host "FrankerzSpam OBS setup v$ScriptVersion" -ForegroundColor Magenta
    Write-Info 'Managed streaming profiles: AV1, HEVC, and H.264 at 1440p60 and 1080p60.'
    Write-Info 'Profiles are alternatives, not simultaneous adaptive renditions.'

    Write-Step 'Inspecting Windows and OBS Studio'
    $winget = Get-WinGetCommand
    if (-not $DryRun) { Assert-ObsClosed }
    Invoke-ObsInstallOrUpdate $winget
    $obsRoot = Join-Path $env:APPDATA 'obs-studio'
    $logsDirectory = Join-Path $obsRoot 'logs'
    $collectionPath = Join-Path $obsRoot "basic\scenes\$CollectionFileName"
    if ($DryRun) {
        Write-Info 'Dry run: reading capability information from existing OBS logs only.'
        $capabilities = Get-EncoderCapabilityMap $logsDirectory
        Show-EncoderCapabilities $capabilities $requestedCodecs $false
        Write-Step 'Dry run: resolved profile matrix'
        $matrixProfiles = @($ManagedProfiles |
            Where-Object { $requestedCodecs -contains $_.Codec -and
                $requestedResolutions -contains $_.Resolution })
        foreach ($profile in $matrixProfiles) {
            $bitrate = $profile.DefaultBitrateKbps
            if ($profile.Key -eq '1440p60-av1') { $bitrate = $BitrateKbps }
            if ($capabilities[$profile.Codec]) {
                $status = 'would create'
            } else {
                # Without a probe, absence in old logs is not proof of absence.
                $status = 'would create if the encoder verifies during a normal run'
            }
            Write-Info "  ${status} : $($profile.Name) - $($profile.Width)x$($profile.Height) 60 FPS, $($profile.Codec) CBR $bitrate Kbps"
        }
        $unverifiedCodecs = @($requestedCodecs | Where-Object { -not $capabilities[$_] })
        if ($unverifiedCodecs.Count -gt 0) {
            $names = $unverifiedCodecs -join ', '
            if ($codecsExplicit) {
                Write-Info "Requested codec(s) $names are unverified; a normal run fails before any write if the probe finds no encoder."
            } else {
                Write-Info "Codec(s) $names are unverified; a normal run skips them (after confirmation) if the probe finds no encoder."
            }
        }
        Write-Info "Would manage the shared scene collection $CollectionName."
        Write-Info 'Would open the site for short-lived channel authorization, then write the credential to every managed profile.'
        Write-Info 'Dry run complete. Nothing was installed, probed, authorized, or written.'
        exit 0
    }
    $obsExecutable = Get-ObsExecutable
    if ($UpdateOnly) {
        Write-Host "`nOBS Studio is installed and up to date." -ForegroundColor Green
        exit 0
    }
    Assert-SupportedObsVersion $obsExecutable

    Write-Step 'Verifying hardware encoder support'
    $capabilities = Get-HardwareEncoderCapabilities $obsExecutable $logsDirectory $requestedCodecs
    Show-EncoderCapabilities $capabilities $requestedCodecs $true
    $selection = Resolve-ManagedSelection $requestedCodecs $requestedResolutions `
        $capabilities $true $codecsExplicit
    if ($selection.Skipped.Count -gt 0 -and
        -not (Read-Confirmation 'Continue without the skipped codecs?' $true)) {
        throw 'Setup cancelled before writing OBS configuration.'
    }
    $managedProfiles = $selection.Profiles
    $profileDirectories = @($managedProfiles | ForEach-Object {
        Join-Path $obsRoot "basic\profiles\$($_.DirectoryName)"
    })

    $existingProfileDirectories = @()
    foreach ($definition in $ManagedProfiles) {
        $directory = Join-Path $obsRoot "basic\profiles\$($definition.DirectoryName)"
        if (Test-Path -LiteralPath $directory) { $existingProfileDirectories += $directory }
    }
    $collectionExists = Test-Path -LiteralPath $collectionPath
    $needsCaptureTargetMigration = $collectionExists -and
        (Test-LegacyExecutableOnlyCaptureTargets $collectionPath)
    if ($needsCaptureTargetMigration) {
        Write-Warning 'The managed scenes contain unreliable executable-only capture targets. Setup will back them up and rebuild the collection.'
    }
    $needsProfileWrite = $false
    foreach ($directory in $profileDirectories) {
        if ((-not (Test-Path -LiteralPath $directory)) -or
            $RepairManagedConfig -or $ResetManagedConfig) {
            $needsProfileWrite = $true
            break
        }
    }
    $needsCollectionWrite = -not $collectionExists -or $ResetManagedConfig -or
        $needsCaptureTargetMigration
    $changesExistingConfiguration = $RepairManagedConfig -or $ResetManagedConfig -or
        $needsCaptureTargetMigration
    $changeConfirmationDefault = $needsCaptureTargetMigration -and
        -not $RepairManagedConfig -and -not $ResetManagedConfig
    if ($changesExistingConfiguration -and
        -not (Read-Confirmation 'Back up and change the existing managed configuration?' $changeConfirmationDefault)) {
        throw 'Setup cancelled.'
    }
    if ($changesExistingConfiguration) {
        Backup-ManagedConfiguration $profileDirectories $collectionPath
    }

    $enableMicrophone = $true
    $enableHotkeys = $false
    if ($needsCollectionWrite) {
        $enableMicrophone = Read-Confirmation 'Enable the Windows default microphone?' $true
        $enableHotkeys = Read-Confirmation 'Add Ctrl+Alt scene hotkeys?' $false
    }

    # A profile is created (or rebuilt) only when its directory is missing or
    # repair/reset was requested. Existing directories are preserved so a
    # partial matrix never overwrites profiles the user already has.
    $forceProfileRewrite = $RepairManagedConfig -or $ResetManagedConfig
    $profileActions = @{}
    foreach ($profile in $managedProfiles) {
        $directory = Join-Path $obsRoot "basic\profiles\$($profile.DirectoryName)"
        $profileActions[$profile.DirectoryName] =
            (-not (Test-Path -LiteralPath $directory)) -or $forceProfileRewrite
    }
    $profilesToCreate = @($managedProfiles |
        Where-Object { $profileActions[$_.DirectoryName] })

    if ($needsProfileWrite -or $needsCollectionWrite) {
        Write-Step 'Resolved managed profile matrix'
        foreach ($profile in $managedProfiles) {
            $action = if ($profileActions[$profile.DirectoryName]) {
                'create'
            } else {
                'preserved'
            }
            Write-Info "  ${action} : $($profile.Name) - $($profile.Width)x$($profile.Height) 60 FPS, $($profile.Codec) CBR $($profile.BitrateKbps) Kbps via $($profile.Encoder.EncoderId) ($($profile.Compatibility))"
        }
        if ($needsCollectionWrite) {
            $confirmation = "Create the $($profilesToCreate.Count) managed profile(s) and the $CollectionName scene collection?"
        } else {
            $confirmation = "Create the $($profilesToCreate.Count) managed profile(s)?"
        }
        if (-not (Read-Confirmation $confirmation $true)) {
            throw 'Setup cancelled before writing OBS configuration.'
        }
    }

    Write-Step 'Creating managed OBS configuration'
    if ($needsProfileWrite) {
        foreach ($profile in $profilesToCreate) {
            $directory = Join-Path $obsRoot "basic\profiles\$($profile.DirectoryName)"
            Write-ManagedProfile $directory $profile
            Write-Info "Created profile $($profile.Name)"
        }
        $preservedCount = $managedProfiles.Count - $profilesToCreate.Count
        if ($preservedCount -gt 0) {
            Write-Info "Preserved $preservedCount existing managed profile(s)."
        }
    } else {
        Write-Info 'Existing managed profiles preserved.'
    }
    if ($needsCollectionWrite) {
        Write-ManagedSceneCollection $collectionPath $enableMicrophone $enableHotkeys
        Write-Info "Created scene collection $CollectionName"
    } else {
        Write-Info 'Existing managed scene collection preserved.'
    }

    Write-Step 'Connecting this computer to your channel'
    Write-Info 'Authorization rotates the previous OBS key and can disconnect its publisher.'
    if (-not (Read-Confirmation 'Open the site and authorize OBS setup?' $true)) {
        throw 'Local OBS configuration was created, but channel authorization was cancelled.'
    }
    $authorization = Start-DeviceAuthorization
    $credentialTargetDirectories = @()
    foreach ($definition in $ManagedProfiles) {
        $directory = Join-Path $obsRoot "basic\profiles\$($definition.DirectoryName)"
        if (Test-Path -LiteralPath $directory) { $credentialTargetDirectories += $directory }
    }
    Write-WhipService $credentialTargetDirectories $authorization.serverUrl $authorization.bearerToken
    $authorization.bearerToken = $null
    Write-Info "WHIP publishing settings saved to $($credentialTargetDirectories.Count) managed profile(s) without printing the credential."
    $warningProperty = $authorization.PSObject.Properties['warning']
    if ($warningProperty -and $warningProperty.Value) {
        Write-Warning $warningProperty.Value
    }

    $preferredProfile = $managedProfiles |
        Sort-Object LaunchPriority, @{ Expression = {
            [array]::IndexOf($ManagedProfiles, $_)
        } } |
        Select-Object -First 1

    if (Read-Confirmation 'Create a FrankerzSpam OBS desktop shortcut?' $true) {
        New-DesktopShortcut $obsExecutable $preferredProfile.Name
        Write-Info 'Desktop shortcut created.'
    }

    Write-Step 'Setup complete'
    Write-Info "OBS will open with the $($preferredProfile.Name) profile and the shared game scenes."
    Write-Info "Switch profiles any time from the Profile menu in OBS. HEVC profiles have limited browser compatibility; 1080p60 H.264 is the safest viewer option."
    Start-Process -FilePath $obsExecutable -WorkingDirectory (Split-Path -Parent $obsExecutable) `
        -ArgumentList '--profile', "`"$($preferredProfile.Name)`"", '--collection', "`"$CollectionName`""
    Write-Host "`nRun a short test stream before inviting viewers." -ForegroundColor Green
} catch {
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'No stream key was printed. Existing unrelated OBS profiles were not changed.'
    exit 1
}
