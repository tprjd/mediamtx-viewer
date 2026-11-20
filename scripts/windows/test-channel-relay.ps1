# Run with Windows PowerShell or pwsh. Pass a v1.20.1 MediaMTX executable to test the real server.
param([string]$MediaServer)
. (Join-Path $PSScriptRoot 'channel-relay.ps1')
Add-Type -AssemblyName System.Net.Http
Add-RelayGuard
if ([Environment]::OSVersion.Platform -eq 'Win32NT') { [RelayGuard]::AttachConsole() }

function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

# Keep these tests independent of the site and a live Channel.
& {
    $script:requests = @()
    $script:location = '/relay/whep/0cf39559-55d6-4097-90f1-166cba83b420'
    $script:deleteStatus = 204
    $mediaId = [guid]::NewGuid().ToString()
    function Invoke-RelayHttp($Client, $Method, $Uri, $Authorization, $Body, $ContentType) {
        $script:requests += $Uri
        if ($Method -ceq 'POST') { return @{ status = 201; location = $script:location; mediaId = $mediaId; body = 'local answer' } }
        if ($Method -ceq 'GET') { return @{ status = 200; body = '{"items":[]}' } }
        if ($Method -ceq 'DELETE') { return @{status = $script:deleteStatus} }
        return @{ status = 204 }
    }
    $sessions = @{}
    $command = @{id = [guid]::NewGuid().ToString(); sessionId = [guid]::NewGuid().ToString(); method = 'POST'; body = 'offer'}
    $reply = Invoke-RelayCommand $null 'test' $sessions $command
    Assert ($reply.localId -ceq $mediaId -and $reply.body -ceq 'local answer') 'Did not create an independent session mapping.'
    Assert (-not $reply.ContainsKey('location')) 'Local session secret escaped into a broker reply.'
    $command.method = 'PATCH'
    Assert ((Invoke-RelayCommand $null 'test' $sessions $command).status -eq 204) 'PATCH did not use local session.'
    Assert ($script:requests[-1] -ceq ('http://127.0.0.1:28889' + $script:location)) 'PATCH used the wrong target.'
    $command.method = 'DELETE'
    $script:deleteStatus = 503
    $failedClosed = $false
    try { $null = Invoke-RelayCommand $null 'test' $sessions $command } catch { $failedClosed = $true }
    Assert $failedClosed 'A failed DELETE must force the media process to restart.'
    $script:deleteStatus = 204
    Assert ((Invoke-RelayCommand $null 'test' $sessions $command).status -eq 204 -and $sessions.Count -eq 0) 'DELETE left an open mapping.'
    Assert ((Invoke-RelayCommand $null 'test' $sessions $command).status -eq 404) 'Unknown DELETE was forwarded.'
    $command.method = 'POST'
    $null = Invoke-RelayCommand $null 'test' $sessions $command
    Assert (@(Get-RelaySessions $null 'test' $sessions).Count -eq 0 -and $sessions.Count -eq 0) 'Ended peers must leave the heartbeat.'
    $script:location = 'https://other.example/foreign'
    $rejected = $false
    try { $null = Invoke-RelayCommand $null 'test' $sessions $command } catch { $rejected = $true }
    Assert ($rejected -and $sessions.Count -eq 0) 'Accepted an unexpected local WHEP resource.'
    $command.method = 'GET'
    Assert ((Invoke-RelayCommand $null 'test' $sessions $command).status -eq 400) 'The bridge accepted an arbitrary HTTP operation.'
}
& {
    $a = @{ id = 'local-a'; path = 'relay'; state = 'read'; peerConnectionEstablished = $true; outboundBytes = 1000 }
    $b = @{ id = 'local-b'; path = 'relay'; state = 'read'; peerConnectionEstablished = $false; outboundBytes = 2000 }
    $extra = @{ id = 'unmapped'; path = 'relay'; state = 'read'; peerConnectionEstablished = $true; outboundBytes = 999999 }
    $source = @{ id = 'upstream'; path = 'relay'; state = 'publish'; peerConnectionEstablished = $true; outboundBytes = 999999 }
    $sessions = @{ 'browser-a' = @{id='local-a'}; 'browser-b' = @{id='local-b'} }
    $meter = @{ at = 0.0; lastNumber = 0 }
    $items = @($a, $b, $extra, $source)
    function Invoke-RelayHttp { return @{ status=200; body=(@{items=$items} | ConvertTo-Json -Depth 3) } }
    function Sample([double]$Seconds) {
        $null = Get-RelaySessions $null 'test' $sessions
        return Get-RelayUploadSample $sessions $meter $Seconds
    }
    $sample = Sample 1
    Assert ($sessions.Count -eq 2 -and $sample.viewerCount -eq 1 -and $null -eq $sample.uploadMbps) 'Only connected, mapped read sessions count. Keep unestablished sessions for signaling.'
    $number = $sample.connections[0].number
    $a.outboundBytes += 8750000
    $sample = Sample 6
    Assert ($sample.uploadMbps -eq 14 -and $sample.connections[0].number -eq $number) 'Wrong measured rate or unstable viewer number.'
    $b.peerConnectionEstablished = $true
    $a.outboundBytes += 1250000
    $sample = Sample 8.5
    Assert ($sample.viewerCount -eq 2 -and $sample.connections[0].uploadMbps -eq 4 -and $null -eq $sample.uploadMbps) 'Joining viewer must not produce a partial total.'
    $a.outboundBytes += 5500000
    $b.outboundBytes += 2750000
    $sample = Sample 14
    Assert ($sample.uploadMbps -eq 12 -and $sample.connections[1].uploadMbps -eq 4) 'Failed to add rates over the actual sample interval.'
    function Write-Progress($Activity, $Status) {
        $script:display = "$Activity $Status"
        $script:peerStatus = $Status
    }
    Show-RelayUpload $sample
    Assert ($script:display.Contains('Connected viewers 2') -and $script:display.Contains((Format-RelayRate 12)) -and $script:display.Contains("Viewer $number")) 'Missing viewer and upload display.'
    Assert ($script:display -notmatch 'local-|browser-|upstream|unmapped') 'Local display exposed session identifiers.'
    foreach ($count in 5, 10) {
        $connections = @(1..$count | ForEach-Object { @{ number = $_; uploadMbps = 14.3 } })
        Show-RelayUpload @{ viewerCount = $count; uploadMbps = $count * 14.3; connections = $connections } 80
        # The classic 80-column progress display indents each status line by four columns.
        $lines = [regex]::Matches($script:peerStatus, '.{1,76}').Value
        foreach ($peer in $connections) {
            $entry = 'Viewer {0}  {1}' -f $peer.number, (Format-RelayRate $peer.uploadMbps)
            Assert (@($lines | Where-Object { $_.Contains($entry) }).Count -eq 1) "Split or missing upload reading for viewer $($peer.number)."
        }
    }
    $items = @($b)
    $b.outboundBytes = 3
    $sample = Sample 19
    Assert ($sample.viewerCount -eq 1 -and $sample.connections[0].number -ne $number -and $null -eq $sample.uploadMbps) 'Departed viewers or reset counters produced a false rate.'
    $b.Remove('outboundBytes')
    $sample = Sample 25
    Assert ($null -eq $sample.uploadMbps) 'Missing counter was reported as zero.'
    $b.outboundBytes = 900
    $sample = Sample 30
    Assert ($null -eq $sample.uploadMbps) 'First counter after a gap must establish a new baseline.'
    $sample = Sample 35
    Assert ($sample.uploadMbps -eq 0) 'Unchanged measured counters should give zero upload.'
    $items = @()
    $sample = Sample 40
    Assert ($sample.viewerCount -eq 0 -and $sample.uploadMbps -eq 0 -and $sessions.Count -eq 0) 'Empty relay retained viewers or upload.'
}
if ($MediaServer) {
    $work = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
    [void][IO.Directory]::CreateDirectory($work)
    $local = New-RelayHttpClient $true 2
    $secret = 'fixture-source-credential'
    try {
        $child = Start-RelayMediaServer (Resolve-Path $MediaServer).Path $work 'wheps://example.invalid/api/relay/source/whep' $secret 'fixture-local-password'
        [RelayGuard]::Watch($child)
        $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('relay:fixture-local-password'))
        $live = $false
        for ($attempt = 0; $attempt -lt 30 -and -not $child.HasExited; $attempt++) {
            try { $null = Get-RelaySessions $local $auth @{}; $live = $true; break } catch { Start-Sleep -Milliseconds 100 }
        }
        Assert $live 'MediaMTX did not start.'
        $info = Invoke-RelayHttp $local GET 'http://127.0.0.1:29997/v3/config/paths/get/relay' $auth $null $null
        Assert (($info.body | ConvertFrom-Json).whepBearerToken -ceq $secret) 'Wrong source credential.'
        Assert (-not ([IO.File]::ReadAllText((Join-Path $work 'relay.yml')).Contains($secret))) 'Credential leaked into the config.'
        Assert ((Invoke-RelayHttp $local GET 'http://127.0.0.1:29997/v3/webrtcsessions/list' $null $null $null).status -eq 401) 'Local API is unprotected.'
        [RelayGuard]::Renew()
        Assert ($child.WaitForExit(20500)) 'A stalled broker left MediaMTX running.'
    } finally {
        [RelayGuard]::Stop()
        if ($child) { $child.Dispose() }
        $local.Dispose()
        Remove-Item -Recurse -Force -LiteralPath $work
    }
}
Write-Host 'Channel relay checks passed.'
