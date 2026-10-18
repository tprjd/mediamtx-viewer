// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const pwsh = process.env.PWSH ?? 'pwsh'
const available = spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0

function checkProfiles(check: string) {
  const directory = mkdtempSync(join(tmpdir(), 'obs-profile-'))
  try {
    const source = readFileSync('scripts/windows/setup-frankerzspam-obs.ps1', 'utf8')
    const payload = source.slice(0, source.indexOf('\ntry {\n    Assert-SupportedHost'))
      .replace('__FRANKERZSPAM_OBS_TIMING_BASE64__', Buffer.from(JSON.stringify({ contractVersion: '1.0.0', keyframeIntervalSeconds: 2 })).toString('base64'))
    writeFileSync(join(directory, 'setup.ps1'), payload)
    writeFileSync(join(directory, 'check.ps1'), `
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
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

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

it.skipIf(!available)('reports partial RTMP progress and stops before later profiles after a file error', () => {
  checkProfiles(`
foreach ($name in @('FrankerzSpam_1440p60_AV1', 'FrankerzSpam_1440p60_HEVC', 'FrankerzSpam_1080p60_H264', 'FrankerzSpam_1080p60_WHIP')) {
    [IO.Directory]::CreateDirectory((Join-Path $obsRoot "basic/profiles/$name")) | Out-Null
}
$blockedService = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1440p60_HEVC/service.json'
[IO.Directory]::CreateDirectory($blockedService) | Out-Null
$RepairManagedConfig = $true
$result = Complete-ManagedObsProfiles $authorization $obsRoot $capabilities $true $selectedProfiles
if ($result.Success -or $result.Error -notmatch 'Rerun setup' -or $result.Profiles.Count -ne 4) { throw 'File failure was not reported' }
$statuses = @($result.Profiles | ForEach-Object { $_.CredentialStatus }) -join ','
if ($statuses -ne 'updated,update not confirmed,not attempted,not attempted') { throw 'Incorrect partial progress' }
$service = Get-Content (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1440p60_AV1/service.json') -Raw | ConvertFrom-Json
if ($service.settings.key -ne 'channels/pilot?token=mtx_sk_test00000000000000000000001') { throw 'Successful write was lost' }
if (Test-Path (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264/service.json')) { throw 'Later RTMP write was attempted' }
if (Get-ChildItem (Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP')) { throw 'WHIP completion ran after RTMP failure' }
$result | ConvertTo-Json -Depth 10 | Write-Output
`)
})
