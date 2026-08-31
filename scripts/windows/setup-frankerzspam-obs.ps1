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
    [string]$SiteOrigin = 'https://frankerzspam.duckdns.org'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptVersion = '1.0.3'
$ProfileName = 'FrankerzSpam 1440p60 AV1'
$ProfileDirectoryName = 'FrankerzSpam_1440p60_AV1'
$CollectionName = 'FrankerzSpam Games'
$CollectionFileName = 'FrankerzSpam_Games.json'
$ObsPackageId = 'OBSProject.OBSStudio'

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
    Write-Info 'OBS Studio must be closed before its profile is changed.'
    if (-not (Read-Confirmation 'Close OBS and continue when it has exited?' $true)) {
        throw 'Setup cancelled because OBS Studio is running.'
    }
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        if (-not (Get-Process obs64 -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Seconds 1
    }
    throw 'OBS Studio is still running. Close it and run setup again.'
}

function Find-EncoderInLogs {
    param(
        [string]$LogsDirectory,
        [datetime]$Since = [datetime]::MinValue
    )
    if (-not (Test-Path -LiteralPath $LogsDirectory)) { return $null }
    $logs = Get-ChildItem -LiteralPath $LogsDirectory -Filter '*.txt' -File |
        Where-Object { $_.LastWriteTime -ge $Since } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 5
    $encoderIds = @(
        'obs_nvenc_av1_tex',
        'jim_av1_nvenc',
        'av1_texture_amf',
        'obs_qsv11_av1'
    )
    foreach ($encoderId in $encoderIds) {
        foreach ($log in $logs) {
            if (Select-String -LiteralPath $log.FullName -SimpleMatch "- $encoderId (" -Quiet) {
                return $encoderId
            }
        }
    }
    return $null
}

function Get-HardwareAv1Encoder {
    param(
        [string]$ObsExecutable,
        [string]$LogsDirectory
    )

    if ($DryRun) { return Find-EncoderInLogs $LogsDirectory }

    Write-Info 'Launching OBS briefly to read its hardware encoder inventory.'
    $probeStartedAt = (Get-Date).AddSeconds(-2)
    $workingDirectory = Split-Path -Parent $ObsExecutable
    $probe = Start-Process -FilePath $ObsExecutable -WorkingDirectory $workingDirectory `
        -ArgumentList '--minimize-to-tray', '--disable-shutdown-check' -PassThru
    try {
        for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
            Start-Sleep -Seconds 1
            $encoder = Find-EncoderInLogs $LogsDirectory $probeStartedAt
            if ($encoder) { break }
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
    return $encoder
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
        [string]$ProfileDirectory,
        [string]$CollectionPath
    )
    if (-not (Test-Path -LiteralPath $ProfileDirectory) -and
        -not (Test-Path -LiteralPath $CollectionPath)) { return }

    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path $env:LOCALAPPDATA "FrankerzSpam\OBS Backups\$timestamp"
    [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
    if (Test-Path -LiteralPath $ProfileDirectory) {
        $profileBackup = Join-Path $backupRoot 'profile'
        [IO.Directory]::CreateDirectory($profileBackup) | Out-Null
        foreach ($name in @('basic.ini', 'streamEncoder.json')) {
            $source = Join-Path $ProfileDirectory $name
            if (Test-Path -LiteralPath $source) {
                Copy-Item -LiteralPath $source -Destination $profileBackup
            }
        }
    }
    if (Test-Path -LiteralPath $CollectionPath) {
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
    param(
        [string]$EncoderId,
        [int]$Bitrate
    )
    $settings = [ordered]@{
        rate_control = 'CBR'
        bitrate = $Bitrate
        keyint_sec = 2
        bf = 0
    }
    if ($EncoderId -in @('obs_nvenc_av1_tex', 'jim_av1_nvenc')) {
        $settings.preset2 = 'p5'
        $settings.tuning = 'hq'
        $settings.multipass = 'qres'
        $settings.profile = 'main'
        $settings.lookahead = $false
        $settings.psycho_aq = $true
    } elseif ($EncoderId -eq 'av1_texture_amf') {
        $settings.quality = 'quality'
    } elseif ($EncoderId -eq 'obs_qsv11_av1') {
        $settings.target_usage = 'balanced'
    }
    return $settings
}

function Write-ManagedProfile {
    param(
        [string]$ProfileDirectory,
        [string]$EncoderId,
        [int]$Bitrate
    )
    [IO.Directory]::CreateDirectory($ProfileDirectory) | Out-Null
    $videosPath = [Environment]::GetFolderPath('MyVideos')
    $basicIni = @"
[General]
Name=$ProfileName

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
Encoder=$EncoderId
AudioEncoder=ffmpeg_opus
Track1Bitrate=160
RecType=Standard
RecFilePath=$videosPath
RecFormat2=mkv
RecUseRescale=false
RecTracks=1

[Video]
BaseCX=2560
BaseCY=1440
OutputCX=2560
OutputCY=1440
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
    $encoderJson = Get-EncoderSettings $EncoderId $Bitrate |
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
        bounds = [ordered]@{ x = 2560.0; y = 1440.0 }
        crop_left = 0
        crop_top = 0
        crop_right = 0
        crop_bottom = 0
        id = $Id
        group_item_backup = $false
        scale_filter = 'lanczos'
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
        [string]$ProfileDirectory,
        [string]$ServerUrl,
        [string]$BearerToken
    )
    if (-not $ServerUrl.StartsWith("$SiteOrigin/publish/whip/")) {
        throw 'The site returned an unexpected WHIP server URL.'
    }
    if (-not $BearerToken.StartsWith('mtx_sk_') -or $BearerToken.Length -lt 48) {
        throw 'The site returned an invalid OBS publishing credential.'
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
    Write-AtomicText (Join-Path $ProfileDirectory 'service.json') $service
}

function New-DesktopShortcut {
    param([string]$ObsExecutable)
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
    Write-Host "FrankerzSpam OBS setup v$ScriptVersion" -ForegroundColor Magenta
    Write-Info 'One managed profile, separate manual scenes, hardware AV1 only.'

    Write-Step 'Inspecting Windows and OBS Studio'
    $winget = Get-WinGetCommand
    if (-not $DryRun) { Assert-ObsClosed }
    Invoke-ObsInstallOrUpdate $winget
    if ($DryRun) {
        Write-Info "Would configure $ProfileName at 2560x1440, 60 FPS, AV1 CBR $BitrateKbps Kbps."
        Write-Info 'Would create Desktop, League of Legends, EVE Online, STALKER 2, Path of Exile, Path of Exile 2, and Generic Game scenes.'
        Write-Info 'Would open the site for short-lived channel authorization only after AV1 preflight.'
        exit 0
    }
    $obsExecutable = Get-ObsExecutable
    if ($UpdateOnly) {
        Write-Host "`nOBS Studio is installed and up to date." -ForegroundColor Green
        exit 0
    }
    Assert-SupportedObsVersion $obsExecutable

    $obsRoot = Join-Path $env:APPDATA 'obs-studio'
    $profileDirectory = Join-Path $obsRoot "basic\profiles\$ProfileDirectoryName"
    $collectionPath = Join-Path $obsRoot "basic\scenes\$CollectionFileName"
    $logsDirectory = Join-Path $obsRoot 'logs'

    Write-Step 'Verifying hardware AV1 support'
    $encoderId = Get-HardwareAv1Encoder $obsExecutable $logsDirectory
    if (-not $encoderId) {
        throw 'OBS did not report NVIDIA, AMD, or Intel hardware AV1 support. Update the GPU driver or use an AV1-capable GPU.'
    }
    Write-Info "Using OBS encoder $encoderId"

    $profileExists = Test-Path -LiteralPath $profileDirectory
    $collectionExists = Test-Path -LiteralPath $collectionPath
    $needsCaptureTargetMigration = $collectionExists -and
        (Test-LegacyExecutableOnlyCaptureTargets $collectionPath)
    if ($needsCaptureTargetMigration) {
        Write-Warning 'The managed scenes contain unreliable executable-only capture targets. Setup will back them up and rebuild the collection.'
    }
    $needsProfileWrite = -not $profileExists -or $RepairManagedConfig -or $ResetManagedConfig
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
        Backup-ManagedConfiguration $profileDirectory $collectionPath
    }

    $enableMicrophone = $true
    $enableHotkeys = $false
    if ($needsCollectionWrite) {
        $enableMicrophone = Read-Confirmation 'Enable the Windows default microphone?' $true
        $enableHotkeys = Read-Confirmation 'Add Ctrl+Alt scene hotkeys?' $false
    }

    if (($needsProfileWrite -or $needsCollectionWrite) -and
        -not (Read-Confirmation "Create the managed 1440p60 AV1 profile and game scenes?" $true)) {
        throw 'Setup cancelled before writing OBS configuration.'
    }

    Write-Step 'Creating managed OBS configuration'
    if ($needsProfileWrite) {
        Write-ManagedProfile $profileDirectory $encoderId $BitrateKbps
        Write-Info "Created profile $ProfileName"
    } else {
        Write-Info 'Existing managed profile preserved.'
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
    Write-WhipService $profileDirectory $authorization.serverUrl $authorization.bearerToken
    $authorization.bearerToken = $null
    Write-Info 'WHIP publishing settings saved without printing the credential.'
    $warningProperty = $authorization.PSObject.Properties['warning']
    if ($warningProperty -and $warningProperty.Value) {
        Write-Warning $warningProperty.Value
    }

    if (Read-Confirmation 'Create a FrankerzSpam OBS desktop shortcut?' $true) {
        New-DesktopShortcut $obsExecutable
        Write-Info 'Desktop shortcut created.'
    }

    Write-Step 'Setup complete'
    Write-Info 'OBS will open with the managed AV1 profile and manual game scenes.'
    Start-Process -FilePath $obsExecutable -WorkingDirectory (Split-Path -Parent $obsExecutable) `
        -ArgumentList '--profile', "`"$ProfileName`"", '--collection', "`"$CollectionName`""
    Write-Host "`nRun a short test stream before inviting viewers." -ForegroundColor Green
} catch {
    Write-Host "`nSetup failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'No stream key was printed. Existing unrelated OBS profiles were not changed.'
    exit 1
}
