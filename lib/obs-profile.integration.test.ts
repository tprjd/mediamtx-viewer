// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const pwsh = process.env.PWSH ?? 'pwsh'
const available = spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0

it.skipIf(!available)('creates and preserves a WHIP profile, refreshes credentials, and excludes secrets from backups', () => {
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
$capabilities = @{ H264 = [pscustomobject]@{ Vendor = 'NVIDIA'; EncoderId = 'obs_nvenc_h264_tex' } }
$rtmp = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_H264'
$rtmpProfile = [pscustomobject]@{ Name = 'RTMP'; Width = 1920; Height = 1080; Codec = 'H264'; BitrateKbps = 10000; Encoder = $capabilities.H264 }
Write-ManagedProfile $rtmp $rtmpProfile 'ffmpeg_aac' 3840 2160
$rtmpBefore = [IO.File]::ReadAllText((Join-Path $rtmp 'basic.ini'))
Write-RtmpService @($rtmp) 'rtmp://example.com:1935/channels/pilot?token=mtx_sk_test00000000000000000000001'
$authorization = [pscustomobject]@{ enabled = $true; serverUrl = 'https://example.com/publish/whip/channels/pilot/whip'; bearerToken = 'mtx_sk_test00000000000000000000001' }
$directory = Join-Path $obsRoot 'basic/profiles/FrankerzSpam_1080p60_WHIP'
Update-ManagedWhipProfile $obsRoot $authorization $capabilities
$basic = [IO.File]::ReadAllText((Join-Path $directory 'basic.ini'))
if ($basic -notmatch 'AudioEncoder=ffmpeg_opus' -or $basic -notmatch 'FPSCommon=60' -or $basic -notmatch 'OutputCX=1920' -or $basic -notmatch 'OutputCY=1080') { throw 'Incorrect output format' }
if ($basic -notmatch 'BaseCX=3840' -or $basic -notmatch 'BaseCY=2160') { throw 'Shared canvas changed' }
if ([IO.File]::ReadAllText((Join-Path $rtmp 'basic.ini')) -ne $rtmpBefore) { throw 'RTMP profile changed' }
$encoder = Get-Content (Join-Path $directory 'streamEncoder.json') -Raw | ConvertFrom-Json
if ($encoder.bf -ne 0 -or $encoder.keyint_sec -ne 2 -or $encoder.bitrate -ne 10000) { throw 'Incorrect encoder settings' }
[IO.File]::AppendAllText((Join-Path $directory 'basic.ini'), "\n; retained user setting")
$authorization.bearerToken = 'mtx_sk_test00000000000000000000002'
Write-RtmpService @($rtmp) "rtmp://example.com:1935/channels/pilot?token=$($authorization.bearerToken)"
$rtmpService = Get-Content (Join-Path $rtmp 'service.json') -Raw | ConvertFrom-Json
if ($rtmpService.type -ne 'rtmp_custom' -or $rtmpService.settings.key -notmatch $authorization.bearerToken) { throw 'RTMP rotation failed' }

Update-ManagedWhipProfile $obsRoot $authorization $capabilities
if ((Get-Content (Join-Path $directory 'basic.ini') -Raw) -notmatch 'retained user setting') { throw 'Rerun overwrote settings' }
$service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
if ($service.type -ne 'whip_custom' -or $service.settings.bearer_token -ne $authorization.bearerToken) { throw 'Credential was not refreshed' }
$RepairManagedConfig = $true
Update-ManagedWhipProfile $obsRoot $authorization $capabilities
if ((Get-Content (Join-Path $directory 'basic.ini') -Raw) -match 'retained user setting') { throw 'Repair did not restore managed defaults' }
$RepairManagedConfig = $false
$invalid = (Get-Content (Join-Path $directory 'basic.ini') -Raw).Replace('ffmpeg_opus', 'ffmpeg_aac')
[IO.File]::WriteAllText((Join-Path $directory 'basic.ini'), $invalid)
try {
    Update-ManagedWhipProfile $obsRoot $authorization $capabilities
    throw 'Invalid retained profile was accepted'
} catch {
    if ($_.Exception.Message -notmatch 'RepairManagedConfig') { throw }
}
$RepairManagedConfig = $true
Update-ManagedWhipProfile $obsRoot $authorization $capabilities
$RepairManagedConfig = $false
$authorization.enabled = $false
$authorization.bearerToken = 'mtx_sk_test00000000000000000000003'
Update-ManagedWhipProfile $obsRoot $authorization $capabilities
$service = Get-Content (Join-Path $directory 'service.json') -Raw | ConvertFrom-Json
if ($service.settings.bearer_token -ne $authorization.bearerToken) { throw 'Disabled pilot retained revoked key' }
Update-ManagedWhipProfile "$PSScriptRoot/not-pilot" $authorization $capabilities
if (Test-Path "$PSScriptRoot/not-pilot") { throw 'Nonpilot profile was created' }
Backup-ManagedConfiguration @($directory) "$PSScriptRoot/absent-scene.json"
if (Get-ChildItem "$env:LOCALAPPDATA/FrankerzSpam/OBS Backups" -Recurse -Filter service.json) { throw 'Secret entered backup' }
$authorization.enabled = $true
try {
    Update-ManagedWhipProfile "$PSScriptRoot/no-encoder" $authorization @{ H264 = $null }
    throw 'Missing encoder was accepted'
} catch {
    if ($_.Exception.Message -notmatch 'needs a supported H.264 hardware encoder') { throw }
}
if (Test-Path "$PSScriptRoot/no-encoder") { throw 'Unsupported profile was written' }
Write-Output 'PROFILE_CHECK_PASSED' 
`)
    const result = spawnSync(pwsh, ['-NoProfile', '-File', join(directory, 'check.ps1')], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('PROFILE_CHECK_PASSED')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
