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
