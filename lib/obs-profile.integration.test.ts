// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const pwsh = process.env.PWSH ?? 'pwsh'
const available = spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0

function checkProfiles(check: string, filesystemFaults = false) {
  const directory = mkdtempSync(join(tmpdir(), 'obs-profile-'))
  try {
    const source = readFileSync('scripts/windows/setup-frankerzspam-obs.ps1', 'utf8')
    const payload = source.slice(0, source.indexOf('\ntry {\n    Assert-SupportedHost'))
      .replace('__FRANKERZSPAM_OBS_TIMING_BASE64__', Buffer.from(JSON.stringify({ contractVersion: '1.0.0', keyframeIntervalSeconds: 2 })).toString('base64'))
    writeFileSync(join(directory, 'setup.ps1'), filesystemFaults ? payload.replaceAll('[IO.File]', '[ControlledFile]') : payload)
    writeFileSync(join(directory, 'check.ps1'), `
${filesystemFaults ? controlledFiles : ''}
. "$PSScriptRoot/setup.ps1"
$env:LOCALAPPDATA = "$PSScriptRoot/local"
$obsRoot = "$PSScriptRoot/obs"
$selectedProfiles = $ManagedProfiles
$capabilities = @{ H264 = [pscustomobject]@{ Vendor = 'NVIDIA'; EncoderId = 'obs_nvenc_h264_tex' } }
$authorization = [pscustomobject]@{
    serverUrl = 'rtmp://example.com:1935/channels/pilot?token=mtx_sk_test00000000000000000000001'
    whip = [pscustomobject]@{ enabled = $true; serverUrl = 'https://example.com/publish/whip/channels/pilot/whip'; bearerToken = 'mtx_sk_test00000000000000000000001' }
}


${check}
Write-Output 'PROFILE_CHECK_PASSED'
`)
    const result = spawnSync(pwsh, ['-NoProfile', '-File', join(directory, 'check.ps1')], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('PROFILE_CHECK_PASSED')
    expect(result.stdout + result.stderr).not.toMatch(/mtx_sk_[A-Za-z0-9_-]+/)
    expect(result.stdout).not.toMatch(/invalid-private-credential|(?:rtmp|https?):\/\//)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

// Fail only the filesystem boundary; completion and atomic replacement still run.
const controlledFiles = `
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
public static class ControlledFile {
    public static string Target;
    public static string Failure;
    public static int Readbacks;
    public static bool Failed;
    public static void WriteAllText(string path, string text, Encoding encoding) { File.WriteAllText(path, text, encoding); }
    public static void WriteAllText(string path, string text) { File.WriteAllText(path, text); }
    public static void AppendAllText(string path, string text) { File.AppendAllText(path, text); }
    public static void Move(string source, string destination) {
        if (destination == Target && Failure == "restore-fails") throw new IOException("Controlled restore failure");
        File.Move(source, destination);
    }
    public static void Replace(string source, string destination, string backup, bool ignore) {
        if (destination == Target && (Failure.StartsWith("before") || Failure.StartsWith("restore"))) {
            Failed = true;
            if (Failure.StartsWith("restore")) File.Move(destination, backup);
            throw new IOException("Controlled replacement failure");
        }
        File.Replace(source, destination, backup, ignore);
    }
    public static void Delete(string path) {
        if (Target != null && path.StartsWith(Target + ".") && path.EndsWith(".replace-backup")) {
            Failed = true;
            if (Failure == "finally") {
                File.Delete(path);
                File.WriteAllText(path.Replace(".replace-backup", ".tmp"), "temporary file");
                return;
            }
            if (Failure == "different") File.WriteAllText(Target, "different settings");
            throw new IOException("Controlled cleanup failure: rtmp://example.com:1935/channels/pilot?token=mtx_sk_test00000000000000000000002");
        }
        File.Delete(path);
    }
    public static string ReadAllText(string path) {
        if (path == Target && Failed) {
            Readbacks++;
            if (Failure == "readback") throw new IOException("Controlled readback failure");
        }
        return File.ReadAllText(path);
    }
}
'@
`

it.skipIf(!available)('completes all retained profiles and returns results without credentials', () => {
  checkProfiles(`
$Codecs = 'H264'
$Resolutions = '1080p'
$selection = Resolve-ManagedSelection @('H264') @('1080p') $capabilities $true $true
$selectedProfiles = $selection.Profiles
if ($selectedProfiles.Count -ne 1) { throw 'Test selection was not narrowed' }
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1080p60_H264')) {
    [IO.Directory]::CreateDirectory((Join-Path $obsRoot "basic/profiles/$name")) | Out-Null
}
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success -or $result.Error -or $result.Profiles.Count -ne 3) { throw 'Completion failed' }
if (@($result.Profiles | Where-Object { $_.CredentialStatus -ne 'updated' }).Count) { throw 'Incomplete profile result' }
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1080p60_H264')) {
    $service = Get-Content (Join-Path $obsRoot "basic/profiles/$name/service.json") -Raw | ConvertFrom-Json
    if ($service.type -ne 'rtmp_custom' -or $service.settings.server -ne 'rtmp://example.com:1935' -or $service.settings.key -ne 'channels/pilot?token=mtx_sk_test00000000000000000000001') { throw 'RTMP credentials not updated' }
}
$service = Get-Content (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP/service.json') -Raw | ConvertFrom-Json
if ($service.type -ne 'whip_custom' -or $service.settings.bearer_token -ne $authorization.whip.bearerToken) { throw 'WHIP credentials not updated' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available)('preserves settings on reruns and restores defaults without backing up credentials', () => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
$rtmpProfile = [pscustomobject]@{ Name = 'RTMP'; Width = 1920; Height = 1080; Codec = 'H264'; BitrateKbps = 10000; Encoder = $capabilities.H264 }
Write-ManagedProfile $rtmp $rtmpProfile 'ffmpeg_aac' 3840 2160
$selection = Resolve-ManagedSelection @('H264') @('1080p') $capabilities $true $true
$selectedProfiles = $selection.Profiles
$excluded = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1440p60_AV1'
[IO.Directory]::CreateDirectory($excluded) | Out-Null
[IO.File]::WriteAllText((Join-Path $excluded 'basic.ini'), "BaseCX=2560\nBaseCY=1440")
$rtmpBefore = [IO.File]::ReadAllText((Join-Path $rtmp 'basic.ini'))
$unrelated = Join-Path $obsRoot 'basic/profiles/Unrelated'
[IO.Directory]::CreateDirectory($unrelated) | Out-Null
[IO.File]::WriteAllText((Join-Path $unrelated 'service.json'), 'unrelated service')
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$basic = [IO.File]::ReadAllText((Join-Path $directory 'basic.ini'))
if ($basic -notmatch 'AudioEncoder=ffmpeg_opus' -or $basic -notmatch 'FPSCommon=60' -or $basic -notmatch 'OutputCX=1920' -or $basic -notmatch 'OutputCY=1080') { throw 'Incorrect output format' }
if ($basic -notmatch 'BaseCX=3840' -or $basic -notmatch 'BaseCY=2160') { throw 'Shared canvas changed' }
$encoder = Get-Content (Join-Path $directory 'streamEncoder.json') -Raw | ConvertFrom-Json
if ($encoder.bf -ne 0 -or $encoder.keyint_sec -ne 2 -or $encoder.bitrate -ne 10000) { throw 'Incorrect encoder settings' }
[IO.File]::AppendAllText((Join-Path $directory 'basic.ini'), "\n; retained user setting")
$basicBefore = [IO.File]::ReadAllText((Join-Path $directory 'basic.ini'))
$encoderBefore = [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json'))
$authorization.whip.bearerToken = 'mtx_sk_test00000000000000000000002'
$authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
if ([IO.File]::ReadAllText((Join-Path $directory 'basic.ini')) -ne $basicBefore -or [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json')) -ne $encoderBefore) { throw 'Rerun overwrote settings' }
$service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.bearer_token -ne $authorization.whip.bearerToken) { throw 'Credential was not refreshed' }
$invalid = $basicBefore.Replace('ffmpeg_opus', 'ffmpeg_aac')
[IO.File]::WriteAllText((Join-Path $directory 'basic.ini'), $invalid)
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'RepairManagedConfig') { throw 'Invalid retained profile was accepted' }
$result | ConvertTo-Json -Depth 10 | Write-Output
foreach ($mode in @('repair', 'reset')) {
    $RepairManagedConfig = $mode -eq 'repair'
    $ResetManagedConfig = $mode -eq 'reset'
    [IO.File]::AppendAllText((Join-Path $directory 'basic.ini'), "\n; retained user setting")
    $result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
    if (-not $result.Success) { throw $result.Error }
    if ((Get-Content (Join-Path $directory 'basic.ini') -Raw) -match 'retained user setting') { throw 'Managed defaults were not restored' }
}
if (-not (Get-ChildItem "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups" -Recurse -Filter basic.ini)) { throw 'Backup was not created' }
if (Get-ChildItem "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups" -Recurse -Filter service.json) { throw 'Secret entered backup' }
if ([IO.File]::ReadAllText((Join-Path $rtmp 'basic.ini')) -ne $rtmpBefore) { throw 'RTMP settings changed' }
if ([IO.File]::ReadAllText((Join-Path $unrelated 'service.json')) -ne 'unrelated service') { throw 'Unrelated profile changed' }
`)
})

it.skipIf(!available)('refreshes a retained WHIP profile after pilot disablement and does not create one for other Channels', () => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$basicBefore = [IO.File]::ReadAllText((Join-Path $directory 'basic.ini'))
$authorization.whip.enabled = $false
$authorization.whip.bearerToken = 'mtx_sk_test00000000000000000000002'
$authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot @{ H264 = $null } $false $selectedProfiles
if (-not $result.Success -or $result.Profiles.Count -ne 2) { throw 'Disabled pilot failed to refresh retained profiles' }
if (@($result.Profiles | Where-Object { $_.CredentialStatus -ne 'updated' }).Count) { throw 'Incomplete retained results' }
$service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.bearer_token -ne $authorization.whip.bearerToken) { throw 'Disabled pilot retained revoked key' }
if ([IO.File]::ReadAllText((Join-Path $directory 'basic.ini')) -ne $basicBefore) { throw 'Disabled pilot settings changed' }
Remove-Item -LiteralPath $directory -Recurse -Force
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success -or $result.Profiles.Count -ne 1 -or (Test-Path $directory)) { throw 'Nonpilot profile was created' }
$authorization.PSObject.Properties.Remove('whip')
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success -or $result.Profiles.Count -ne 1 -or (Test-Path $directory)) { throw 'RTMP-only completion failed' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each(['output', 'encoder'])('refreshes retained credentials before reporting missing WHIP %s', (missing) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$basicBefore = [IO.File]::ReadAllText((Join-Path $directory 'basic.ini'))
$encoderBefore = [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json'))
$supported = '${missing}' -ne 'output'
if ('${missing}' -eq 'encoder') { $capabilities.H264 = $null }
foreach ($mode in @('normal', 'repair', 'reset')) {
    $RepairManagedConfig = $mode -eq 'repair'
    $ResetManagedConfig = $mode -eq 'reset'
    $authorization.whip.bearerToken = 'mtx_sk_' + ('r' * 31) + $mode
    $authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
    $result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $supported $selectedProfiles
    if ($result.Success -or $result.Error -notmatch 'WHIP output is missing|H.264.*encoder') { throw 'Missing capability was accepted' }
    if (@($result.Profiles | Where-Object { $_.CredentialStatus -ne 'updated' }).Count) { throw 'Retained credentials not reported updated' }
    $service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
    $rtmpService = Get-Content (Join-Path $rtmp 'service.json') -Raw | ConvertFrom-Json
    if ($service.settings.bearer_token -ne $authorization.whip.bearerToken -or $rtmpService.settings.key -ne "channels/pilot?token=$($authorization.whip.bearerToken)") { throw 'Retained profile kept revoked credentials' }
    if ([IO.File]::ReadAllText((Join-Path $directory 'basic.ini')) -ne $basicBefore -or [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json')) -ne $encoderBefore) { throw 'Failed completion changed settings' }
    if (-not $authorization.whip.enabled) { throw 'Completion changed the authorization response' }
    $result | ConvertTo-Json -Depth 10 | Write-Output
}
Remove-Item -LiteralPath $directory -Recurse -Force
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $supported $selectedProfiles
if ($result.Success -or (Test-Path $directory)) { throw 'Unsupported new profile was written' }
if ($result.Profiles[0].CredentialStatus -ne 'updated' -or $result.Profiles[1].CredentialStatus -ne 'not attempted') { throw 'Incorrect capability failure result' }
`)
})

it.skipIf(!available).each(['normal', 'repair', 'reset', 'disabled'])('continues retained credential refreshes after a file error and blocks WHIP completion in %s mode', (mode) => {
  checkProfiles(`
$selectedProfiles = (Resolve-ManagedSelection @('H264') @('1080p') $capabilities $true $true).Profiles
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1440p60_HEVC', 'FrankerzSpam_1080p60_H264', 'FrankerzSpam_1080p60_WHIP')) {
    [IO.Directory]::CreateDirectory((Join-Path $obsRoot "basic/profiles/$name")) | Out-Null
}
$blockedService = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1440p60_HEVC/service.json'
[IO.Directory]::CreateDirectory($blockedService) | Out-Null
$RepairManagedConfig = '${mode}' -eq 'repair'
$ResetManagedConfig = '${mode}' -eq 'reset'
$authorization.whip.enabled = '${mode}' -ne 'disabled'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'Rerun setup' -or $result.Profiles.Count -ne 4) { throw 'File failure was not reported' }
$statuses = @($result.Profiles | ForEach-Object { $_.CredentialStatus }) -join ','
if ($statuses -ne 'updated,update not confirmed,updated,updated') { throw 'Independent refreshes were not completed' }
if ($result.Error -notmatch 'FrankerzSpam_1440p60_HEVC') { throw 'Failed profile was not identified' }
$service = Get-Content (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1440p60_AV1/service.json') -Raw | ConvertFrom-Json
if ($service.settings.key -ne 'channels/pilot?token=mtx_sk_test00000000000000000000001') { throw 'Successful write was lost' }
$service = Get-Content (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264/service.json') -Raw | ConvertFrom-Json
if ($service.settings.key -cne 'channels/pilot?token=mtx_sk_test00000000000000000000001') { throw 'Later RTMP credential was not refreshed' }
$whipDirectory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$service = Get-Content (Join-Path $whipDirectory 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.bearer_token -cne $authorization.whip.bearerToken) { throw 'Retained WHIP credential was not refreshed' }
if (@(Get-ChildItem $whipDirectory).Count -ne 1 -or (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups")) { throw 'WHIP repair ran after RTMP failure' }
$result | ConvertTo-Json -Depth 10 | Write-Output
Remove-Item -LiteralPath $whipDirectory -Recurse -Force
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or (Test-Path $whipDirectory)) { throw 'WHIP creation ran after RTMP failure' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available)('refreshes retained WHIP credentials when no RTMP profiles remain', () => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
Remove-Item -LiteralPath $rtmp -Recurse -Force
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
[IO.File]::WriteAllText((Join-Path $directory 'basic.ini'), 'retained user settings')
$authorization.whip.bearerToken = 'mtx_sk_test00000000000000000000002'
$authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'No managed OBS profiles' -or $result.Profiles[0].CredentialStatus -ne 'updated') { throw 'Missing RTMP profiles blocked retained WHIP refresh' }
$service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.bearer_token -cne $authorization.whip.bearerToken) { throw 'Retained WHIP kept the revoked key' }
if ([IO.File]::ReadAllText((Join-Path $directory 'basic.ini')) -cne 'retained user settings') { throw 'Missing RTMP profiles allowed WHIP repair' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each([
  ['invalid token', "$authorization.serverUrl = 'rtmp://example.com:1935/channels/pilot?token=invalid-private-credential'"],
  ['invalid scheme', "$authorization.serverUrl = 'https://example.com:1935/channels/pilot?token=mtx_sk_test00000000000000000000001'"],
  ['invalid port', "$authorization.serverUrl = 'rtmp://example.com:99999/channels/pilot?token=mtx_sk_test00000000000000000000001'"],
  ['missing URL', "$authorization.PSObject.Properties.Remove('serverUrl')"],
])('refreshes retained WHIP credentials when RTMP settings are rejected: %s', (_label, invalidate) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$rtmpBefore = [IO.File]::ReadAllText((Join-Path $rtmp 'service.json'))
[IO.File]::WriteAllText((Join-Path $directory 'basic.ini'), 'retained user settings')
$encoderBefore = [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json'))
${invalidate}
foreach ($mode in @('normal', 'repair', 'reset', 'disabled')) {
    $RepairManagedConfig = $mode -eq 'repair'
    $ResetManagedConfig = $mode -eq 'reset'
    $authorization.whip.enabled = $mode -ne 'disabled'
    $authorization.whip.bearerToken = 'mtx_sk_' + ('r' * 31) + $mode
    $result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
    if ($result.Success -or $result.Error -notmatch 'RTMP.*rejected') { throw 'Invalid RTMP settings were not rejected' }
    if ($result.Profiles[0].CredentialStatus -ne 'settings rejected' -or $result.Profiles[1].CredentialStatus -ne 'updated') { throw 'Incorrect independent update result' }
    $service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
    if ($service.settings.bearer_token -cne $authorization.whip.bearerToken) { throw 'Valid WHIP credential was not refreshed' }
    if ([IO.File]::ReadAllText((Join-Path $rtmp 'service.json')) -cne $rtmpBefore) { throw 'Rejected RTMP settings were written' }
    if ([IO.File]::ReadAllText((Join-Path $directory 'basic.ini')) -cne 'retained user settings' -or [IO.File]::ReadAllText((Join-Path $directory 'streamEncoder.json')) -cne $encoderBefore) { throw 'Validation failure did not block repair' }
    if (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups") { throw 'Validation failure created a backup' }
    $result | ConvertTo-Json -Depth 10 | Write-Output
}
Remove-Item -LiteralPath $directory -Recurse -Force
$authorization.whip.enabled = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or (Test-Path $directory)) { throw 'Validation failure created a WHIP profile' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each([
  ['query', "$authorization.whip.serverUrl = 'https://example.com/publish/whip/channels/pilot/whip?token=invalid-private-credential'"],
  ['fragment', "$authorization.whip.serverUrl += '#invalid-private-credential'"],
  ['user info', "$authorization.whip.serverUrl = 'https://user:invalid-private-credential@example.com/publish/whip/channels/pilot/whip'"],
  ['remote HTTP', "$authorization.whip.serverUrl = 'http://example.com/publish/whip/channels/pilot/whip'"],
  ['wrong path', "$authorization.whip.serverUrl = 'https://example.com/channels/pilot'"],
  ['invalid token', "$authorization.whip.bearerToken = 'invalid-private-credential'"],
  ['missing token', "$authorization.whip.PSObject.Properties.Remove('bearerToken')"],
  ['null settings', '$authorization.whip = $null'],
])('refreshes retained RTMP credentials when WHIP settings are rejected: %s', (_label, invalidate) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$before = @{}
foreach ($file in Get-ChildItem $directory -File) { $before[$file.Name] = [IO.File]::ReadAllText($file.FullName) }
$authorization.serverUrl = 'rtmp://example.com:1935/channels/pilot?token=mtx_sk_test00000000000000000000002'
${invalidate}
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'WHIP.*rejected') { throw 'Invalid WHIP settings were not rejected' }
if ($result.Profiles[0].CredentialStatus -ne 'updated' -or $result.Profiles[1].CredentialStatus -ne 'settings rejected') { throw 'Incorrect independent update result' }
$service = Get-Content (Join-Path $rtmp 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.key -cne 'channels/pilot?token=mtx_sk_test00000000000000000000002') { throw 'Valid RTMP credential was not refreshed' }
foreach ($name in $before.Keys) {
    if ([IO.File]::ReadAllText((Join-Path $directory $name)) -cne $before[$name]) { throw 'Rejected WHIP settings changed a file' }
}
if (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups") { throw 'Rejected WHIP settings created a backup' }
$result | ConvertTo-Json -Depth 10 | Write-Output
Remove-Item -LiteralPath $directory -Recurse -Force
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or (Test-Path $directory)) { throw 'Rejected WHIP settings created a profile' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available)('reports both rejected formats without writing any profile files', () => {
  checkProfiles(`
$before = @{}
foreach ($name in @('FrankerzSpam_1080p60_H264', 'FrankerzSpam_1080p60_WHIP')) {
    $directory = Join-Path $obsRoot "basic/profiles/$name"
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    foreach ($file in @('service.json', 'basic.ini', 'streamEncoder.json')) {
        $path = Join-Path $directory $file
        [IO.File]::WriteAllText($path, 'retained user settings')
        [IO.File]::SetLastWriteTimeUtc($path, [datetime]'2001-01-01')
        $before[$path] = [IO.File]::ReadAllText($path)
    }
}
$authorization.serverUrl = 'invalid-private-credential'
$authorization.whip.bearerToken = 'invalid-private-credential'
$ResetManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'RTMP.*rejected' -or $result.Error -notmatch 'WHIP.*rejected') { throw 'Both validation errors were not reported' }
if (@($result.Profiles | Where-Object { $_.CredentialStatus -ne 'settings rejected' }).Count) { throw 'Rejected credentials were attempted' }
foreach ($path in $before.Keys) {
    if ([IO.File]::ReadAllText($path) -cne $before[$path] -or [IO.File]::GetLastWriteTimeUtc($path) -ne [datetime]'2001-01-01') { throw 'Rejected settings changed a file' }
}
if (@(Get-ChildItem $obsRoot -Recurse -File).Count -ne $before.Count -or (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups")) { throw 'Rejected settings created files' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each([
  ['RTMP://EXAMPLE.COM:21935/channels/pilot', 'https://example.com:8443/publish/whip/channels/%70ilot/whip'],
  ['rtmp://localhost:21935/channels/pilot', 'http://localhost:3000/publish/whip/channels/pilot/whip'],
])('accepts consistent publishing identities with different URL forms: %s', (rtmpUrl, whipUrl) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$authorization.serverUrl = '${rtmpUrl}?token=mtx_sk_test00000000000000000000001'
$authorization.whip.serverUrl = '${whipUrl}'
$authorization | Add-Member streamKey 'mtx_sk_test00000000000000000000001'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success -or $result.Error) { throw 'Consistent publishing identities were rejected' }
if ($result.Profiles.Count -ne 2 -or @($result.Profiles | Where-Object { $_.CredentialStatus -ne 'updated' }).Count) { throw 'Consistent settings were not reported updated' }
$service = Get-Content (Join-Path $rtmp 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.key -cne 'channels/pilot?token=mtx_sk_test00000000000000000000001') { throw 'RTMP settings were not written' }
$service = Get-Content (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP/service.json') -Raw | ConvertFrom-Json
if ($service.settings.server -cne '${whipUrl}' -or $service.settings.bearer_token -cne $authorization.whip.bearerToken) { throw 'WHIP settings were not written' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each(['Channel', 'hostname', 'Stream key'])('rejects a %s conflict before any profile writes', (conflict) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$before = @{}
foreach ($file in Get-ChildItem $obsRoot -Recurse -File) {
    [IO.File]::SetLastWriteTimeUtc($file.FullName, [datetime]'2001-01-01')
    $before[$file.FullName] = [IO.File]::ReadAllText($file.FullName)
}
$authorization.whip.bearerToken = 'mtx_sk_' + ('r' * 24)
$authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
switch ('${conflict}') {
    'Channel' { $authorization.whip.serverUrl = 'https://example.com/publish/whip/channels/another/whip' }
    'hostname' { $authorization.whip.serverUrl = 'https://other.example.com/publish/whip/channels/pilot/whip' }
    'Stream key' { $authorization.whip.bearerToken = 'mtx_sk_' + ('R' * 24) }
}
foreach ($mode in @('normal', 'repair', 'reset')) {
    $RepairManagedConfig = $mode -eq 'repair'
    $ResetManagedConfig = $mode -eq 'reset'
    $result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
    if ($result.Success -or $result.Error -notmatch '${conflict}.*conflict') { throw 'Conflicting response was not rejected' }
    if (@($result.Profiles | Where-Object { $_.CredentialStatus -ne 'not attempted' }).Count) { throw 'Conflict attempted a credential write' }
    foreach ($path in $before.Keys) {
        if ([IO.File]::ReadAllText($path) -cne $before[$path] -or [IO.File]::GetLastWriteTimeUtc($path) -ne [datetime]'2001-01-01') { throw 'Conflict changed a profile file' }
    }
    if (@(Get-ChildItem $obsRoot -Recurse -File).Count -ne $before.Count -or (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups")) { throw 'Conflict created files' }
    $result | ConvertTo-Json -Depth 10 | Write-Output
}
Remove-Item -LiteralPath $directory -Recurse -Force
foreach ($enabled in @($true, $false)) {
    $authorization.whip.enabled = $enabled
    $result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
    if ($result.Success -or $result.Error -notmatch '${conflict}.*conflict' -or (Test-Path $directory)) { throw 'Conflict was accepted without a retained WHIP profile' }
    $path = Join-Path $rtmp 'service.json'
    if ([IO.File]::ReadAllText($path) -cne $before[$path] -or [IO.File]::GetLastWriteTimeUtc($path) -ne [datetime]'2001-01-01') { throw 'Conflict changed RTMP credentials' }
    $result | ConvertTo-Json -Depth 10 | Write-Output
}
`)
})

it.skipIf(!available).each(['both', 'RTMP', 'WHIP'])('rejects a conflicting response Stream key with valid %s settings', (valid) => {
  checkProfiles(`
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
[IO.Directory]::CreateDirectory($rtmp) | Out-Null
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$before = @{}
foreach ($file in Get-ChildItem $obsRoot -Recurse -File) {
    [IO.File]::SetLastWriteTimeUtc($file.FullName, [datetime]'2001-01-01')
    $before[$file.FullName] = [IO.File]::ReadAllText($file.FullName)
}
$authorization | Add-Member streamKey 'mtx_sk_conflicting000000000000000000'
if ('${valid}' -eq 'RTMP') { $authorization.whip.bearerToken = 'invalid-private-credential' }
if ('${valid}' -eq 'WHIP') { $authorization.serverUrl = 'invalid-private-credential' }
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'Stream key.*conflict') { throw 'Conflicting response Stream key was not rejected' }
foreach ($path in $before.Keys) {
    if ([IO.File]::ReadAllText($path) -cne $before[$path] -or [IO.File]::GetLastWriteTimeUtc($path) -ne [datetime]'2001-01-01') { throw 'Conflicting response Stream key changed a file' }
}
if (@(Get-ChildItem $obsRoot -Recurse -File).Count -ne $before.Count -or (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups")) { throw 'Conflicting response Stream key created files' }
$result | ConvertTo-Json -Depth 10 | Write-Output
Remove-Item -LiteralPath $directory -Recurse -Force
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'Stream key.*conflict' -or (Test-Path $directory)) { throw 'Conflicting response Stream key allowed profile creation' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})

it.skipIf(!available).each([
  ['cleanup', 'AV1', 'updated, cleanup failed'],
  ['different', 'AV1', 'update not confirmed'],
  ['readback', 'AV1', 'update not confirmed'],
  ['before', 'AV1', 'update not confirmed'],
  ['before-matching', 'AV1', 'credential confirmed, write failed'],
  ['before-finally', 'AV1', 'update not confirmed'],
  ['finally', 'AV1', 'updated, cleanup failed'],
  ['restore', 'AV1', 'update not confirmed'],
  ['restore-fails', 'AV1', 'update not confirmed'],
  ['cleanup', 'WHIP', 'updated, cleanup failed'],
  ['before', 'WHIP', 'update not confirmed'],
  ['readback', 'WHIP', 'update not confirmed'],
])('reports %s failure for %s from readback and preserves independent updates', (failure, target, status) => {
  checkProfiles(`
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1080p60_H264')) {
    [IO.Directory]::CreateDirectory((Join-Path $obsRoot "basic/profiles/$name")) | Out-Null
}
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not $result.Success) { throw $result.Error }
$whipDirectory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
[IO.File]::WriteAllText((Join-Path $whipDirectory 'basic.ini'), 'retained user settings')
$encoderBefore = [IO.File]::ReadAllText((Join-Path $whipDirectory 'streamEncoder.json'))
if ('${failure}' -ne 'before-matching') { $authorization.whip.bearerToken = 'mtx_sk_test00000000000000000000002' }
$authorization.serverUrl = "rtmp://example.com:1935/channels/pilot?token=$($authorization.whip.bearerToken)"
$targetName = if ('${target}' -eq 'WHIP') { 'FrankerzSpam_1080p60_WHIP' } else { 'FrankerzSpam_1440p60_AV1' }
[ControlledFile]::Target = Join-Path $obsRoot "basic/profiles/$targetName/service.json"
[ControlledFile]::Failure = '${failure}'
if ('${failure}' -match 'finally$') {
    function Remove-Item {
        [CmdletBinding()]
        param([string]$LiteralPath, [switch]$Force)
        if ($LiteralPath -like (([ControlledFile]::Target) + '.*.tmp')) {
            throw 'Controlled final cleanup failure'
        }
        Microsoft.PowerShell.Management\\Remove-Item @PSBoundParameters
    }
}
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if (-not [ControlledFile]::Failed) { throw 'Controlled filesystem failure did not run' }
$originalError = if ('${failure}' -match '^(before|restore)') { 'Controlled replacement failure' } elseif ('${failure}' -eq 'finally') { 'Controlled final cleanup failure' } else { 'Controlled cleanup failure' }
if ($result.Success -or $result.Error -notmatch $originalError -or $result.Error -notmatch $targetName -or $result.Error -match 'Controlled readback failure|Controlled restore failure') { throw 'Original operation error was lost' }
if ('${failure}' -eq 'before-finally' -and $result.Error -match 'Controlled final cleanup failure') { throw 'Cleanup replaced the write error' }
if ([ControlledFile]::Readbacks -ne 1) { throw 'Failed credential write was not read back' }
foreach ($profile in $result.Profiles) {
    $expectedStatus = if ($profile.Name -eq $targetName) { '${status}' } else { 'updated' }
    if ($profile.CredentialStatus -ne $expectedStatus) { throw 'Incorrect credential failure outcome' }
}
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1080p60_H264')) {
    if ($name -eq $targetName) { continue }
    $service = [System.IO.File]::ReadAllText((Join-Path $obsRoot "basic/profiles/$name/service.json")) | ConvertFrom-Json
    if ($service.settings.key -cne "channels/pilot?token=$($authorization.whip.bearerToken)") { throw 'Independent RTMP update was lost' }
}
if ('${target}' -ne 'WHIP') {
    $service = [System.IO.File]::ReadAllText((Join-Path $whipDirectory 'service.json')) | ConvertFrom-Json
    if ($service.settings.bearer_token -cne $authorization.whip.bearerToken) { throw 'Independent WHIP update was lost' }
}
if ('${failure}' -eq 'restore-fails') {
    if (Test-Path -LiteralPath ([ControlledFile]::Target)) { throw 'Failed restoration unexpectedly created a destination' }
    $backup = @(Get-ChildItem (([ControlledFile]::Target) + '.*.replace-backup'))
    if ($backup.Count -ne 1 -or [System.IO.File]::ReadAllText($backup[0].FullName) -notmatch 'test00000000000000000000001') { throw 'Recovery backup was lost' }
} elseif ('${failure}' -eq 'different') {
    if ([System.IO.File]::ReadAllText([ControlledFile]::Target) -cne 'different settings') { throw 'Mismatched readback was not exercised' }
} else {
    $service = [System.IO.File]::ReadAllText([ControlledFile]::Target) | ConvertFrom-Json
    $expectedToken = if ('${failure}' -match '^(before|restore)') { 'mtx_sk_test00000000000000000000001' } else { $authorization.whip.bearerToken }
    $actual = if ('${target}' -eq 'WHIP') { $service.settings.bearer_token } else { $service.settings.key }
    $expected = if ('${target}' -eq 'WHIP') { $expectedToken } else { "channels/pilot?token=$expectedToken" }
    if ($actual -cne $expected) { throw 'Unexpected credential file after the operation error' }
}
if ([IO.File]::ReadAllText((Join-Path $whipDirectory 'basic.ini')) -cne 'retained user settings' -or [IO.File]::ReadAllText((Join-Path $whipDirectory 'streamEncoder.json')) -cne $encoderBefore -or (Test-Path "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups")) { throw 'Cleanup failure allowed WHIP repair' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`, true)
}, 15000)
