# Runs under Windows PowerShell 5.1, as the signed-in Windows user.
$ErrorActionPreference = 'Stop'

function Install-RelayMediaServer($Directory) {
    $exe = Join-Path $Directory 'mediamtx-1.20.1.exe'
    $exeHash = '114e6c0b514813658e10be55f8ab6eab950ae879943272a59b0a51d55930900a'
    if ((Test-Path -LiteralPath $exe) -and (Get-FileHash -LiteralPath $exe).Hash -eq $exeHash) { return $exe }

    $work = Join-Path $Directory ([guid]::NewGuid().ToString())
    [void][IO.Directory]::CreateDirectory($work)
    try {
        $zip = Join-Path $work 'release.zip'
        Write-Host 'Downloading the verified Windows x64 MediaMTX release...'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/bluenviron/mediamtx/releases/download/v1.20.1/mediamtx_v1.20.1_windows_amd64.zip' -OutFile $zip -TimeoutSec 120
        if ((Get-FileHash -LiteralPath $zip).Hash -ne 'dc970f8e1f3ad58edafcf536bcd1ffe0adcb4390e7ace9377694a9ea2c1ebe53') {
            throw 'MediaMTX download checksum failed.'
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $work
        $verified = Join-Path $work 'mediamtx.exe'
        if ((Get-FileHash -LiteralPath $verified).Hash -ne $exeHash) { throw 'MediaMTX binary checksum failed.' }
        Move-Item -Force -LiteralPath $verified -Destination $exe
    } finally { Remove-Item -Recurse -Force -LiteralPath $work }
    return $exe
}

function New-RelayHttpClient([bool]$Local, [int]$TimeoutSeconds) {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    if ($Local) { $handler.UseProxy = $false }
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $client.MaxResponseContentBufferSize = 1048576
    return $client
}

function Invoke-RelayHttp($Client, $Method, $Uri, $Authorization, $Body, $ContentType) {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method), [uri]$Uri)
    try {
        if ($Authorization) { [void]$request.Headers.TryAddWithoutValidation('Authorization', $Authorization) }
        if ($Method -eq 'PATCH') { [void]$request.Headers.TryAddWithoutValidation('If-Match', '*') }
        if ($null -ne $Body) {
            $request.Content = [Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes([string]$Body))
            $request.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new($ContentType)
        }
        $response = $Client.SendAsync($request).GetAwaiter().GetResult()
        try {
            $mediaId = $null
            if ($response.Headers.Contains('ID')) { $mediaId = @($response.Headers.GetValues('ID'))[0] }
            return @{
                status = [int]$response.StatusCode
                body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                location = [string]$response.Headers.Location
                mediaId = $mediaId
            }
        } finally { $response.Dispose() }
    } finally { $request.Dispose() }
}

function Get-RelayCredential($Client, $Bootstrap, $StateFile) {
    if (Test-Path -LiteralPath $StateFile) {
        $secure = ConvertTo-SecureString ([IO.File]::ReadAllText($StateFile))
        return [Net.NetworkCredential]::new('', $secure).Password
    }
    $body = @{ticket = $Bootstrap.ticket} | ConvertTo-Json -Compress
    $pair = Invoke-RelayHttp $Client POST ($Bootstrap.origin + '/api/relay/pair') $null $body 'application/json'
    if ($pair.status -ne 200 -and $pair.status -ne 201) { throw 'Pairing failed. Download a fresh relay from your Channel page.' }
    $credential = ($pair.body | ConvertFrom-Json).credential
    if ($credential -cnotmatch '^[A-Za-z0-9_-]{16,256}$') { throw 'Invalid pairing response.' }
    # Windows DPAPI binds this file to the current Windows user.
    $secure = ConvertTo-SecureString $credential -AsPlainText -Force
    $temp = $StateFile + '.new'
    [IO.File]::WriteAllText($temp, (ConvertFrom-SecureString $secure))
    [IO.File]::Move($temp, $StateFile)
    return $credential
}

function New-RelayConfig($Source, $LocalPassword, $PublicHost) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $passwordHash = [Convert]::ToBase64String($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($LocalPassword))) }
    finally { $hash.Dispose() }
    $hosts = @()
    if ($PublicHost) {
        if ([uri]::CheckHostName($PublicHost) -eq 'Unknown') { throw 'Invalid relay public hostname.' }
        $hosts = @($PublicHost)
    }
    return @{
        logLevel = 'error'
        rtsp = $false; rtmp = $false; srt = $false; moq = $false; hls = $false
        webrtcAddress = '127.0.0.1:28889'
        webrtcLocalUDPAddress = ':28189'; webrtcLocalTCPAddress = ':28189'
        webrtcAdditionalHosts = $hosts
        webrtcIPsFromInterfaces = ($hosts.Count -eq 0)
        webrtcICEServers2 = @(@{url = 'stun:stun.cloudflare.com:3478'})
        api = $true; apiAddress = '127.0.0.1:29997'
        authInternalUsers = @(@{ user = 'relay'; pass = ('sha256:' + $passwordHash); ips = @('127.0.0.1')
            permissions = @(@{ action = 'read'; path = 'relay' }, @{ action = 'api' }) })
        paths = @{relay = @{ source = $Source; sourceOnDemand = $true; sourceOnDemandCloseAfter = '1s' }}
    }
}

function Start-RelayMediaServer($Exe, $Directory, $Source, $Credential, $Password) {
    $config = New-RelayConfig $Source $Password $env:FRANKERZ_RELAY_PUBLIC_HOST
    [IO.File]::WriteAllText((Join-Path $Directory 'relay.yml'), ($config | ConvertTo-Json -Depth 8))
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Exe
    $info.WorkingDirectory = $Directory
    $info.Arguments = 'relay.yml'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($key in @($info.EnvironmentVariables.Keys)) {
        if ($key -match '^(MTX|RTSP)_') { $info.EnvironmentVariables.Remove($key) }
    }
    # The reusable source credential stays out of files, process arguments and logs.
    $info.EnvironmentVariables['MTX_PATHS_RELAY_WHEPBEARERTOKEN'] = $Credential
    return [Diagnostics.Process]::Start($info)
}

function Invoke-RelayCommand($Local, $Auth, $Sessions, $Command) {
    $reply = @{id = $Command.id; status = 400}
    $session = [string]$Command.sessionId
    $guid = [guid]::Empty
    if (-not [guid]::TryParseExact($session, 'D', [ref]$guid)) { return $reply }
    $method = [string]$Command.method
    if ($method -ceq 'POST') {
        if ($Sessions.ContainsKey($session)) {
            $previous = $Sessions[$session].reply.Clone()
            $previous.id = $Command.id
            return $previous
        }
        if (-not ($Command.body -is [string]) -or $Command.body.Length -gt 131072) { return $reply }
        $uri = 'http://127.0.0.1:28889/relay/whep'
        $contentType = 'application/sdp'
    } elseif ($method -ceq 'PATCH' -or $method -ceq 'DELETE') {
        if (-not $Sessions.ContainsKey($session)) { $reply.status = 404; return $reply }
        $uri = 'http://127.0.0.1:28889' + $Sessions[$session].location
        $contentType = 'application/trickle-ice-sdpfrag'
        if ($method -ceq 'PATCH' -and (-not ($Command.body -is [string]) -or $Command.body.Length -gt 131072)) { return $reply }
    } else { return $reply }
    $body = $null
    if ($method -cne 'DELETE') { $body = $Command.body }
    $result = Invoke-RelayHttp $Local $method $uri $Auth $body $contentType
    $reply.status = $result.status
    if ($method -ceq 'POST' -and $result.status -eq 201) {
        if ($result.location -cnotmatch '^/relay/whep/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$' -or
            -not [guid]::TryParseExact([string]$result.mediaId, 'D', [ref]$guid)) { throw 'Invalid local session response.' }
        $reply.body = $result.body
        $reply.localId = $result.mediaId
        $Sessions[$session] = @{ id = $result.mediaId; location = $result.location; reply = $reply }
    } elseif ($method -ceq 'DELETE') {
        if ($result.status -notin 200,204,404) { throw 'Cannot confirm local peer disconnection.' }
        $Sessions.Remove($session)
    }
    return $reply
}

function Get-RelaySessions($Local, $Auth, $Sessions) {
    $state = Invoke-RelayHttp $Local GET 'http://127.0.0.1:29997/v3/webrtcsessions/list?itemsPerPage=1000' $Auth $null $null
    if ($state.status -ne 200) { throw 'Local media status unavailable.' }
    $active = @{}
    foreach ($peer in ($state.body | ConvertFrom-Json).items) {
        if ($peer.path -ceq 'relay' -and $peer.state -ceq 'read') { $active[$peer.id] = $true }
    }
    foreach ($key in @($Sessions.Keys)) {
        if (-not $active.ContainsKey($Sessions[$key].id)) { $Sessions.Remove($key) }
    }
    return @($Sessions.Keys)
}

function Add-RelayGuard {
    # A Windows job owns every child. Closing this console also closes established media sessions.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class RelayGuard {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, byte[] info, int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    static IntPtr job;
    public static void AttachConsole() {
        job = CreateJobObject(IntPtr.Zero, null);
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION.BasicLimitInformation.LimitFlags = KILL_ON_JOB_CLOSE
        var info = new byte[IntPtr.Size == 8 ? 144 : 112];
        BitConverter.GetBytes(0x2000).CopyTo(info, 16);
        if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, info, info.Length)
            || !AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    static readonly object gate = new object();
    static Process child;
    static Stopwatch lease;
    static Timer timer;
    public static void Watch(Process p) {
        lock (gate) {
            child = p;
            lease = Stopwatch.StartNew();
            timer = new Timer(delegate { lock (gate) {
                if (child != null && lease.ElapsedMilliseconds >= 19000) Stop();
            } }, null, 250, 250);
        }
    }
    public static void Renew() { lock (gate) {
        if (child != null && lease.ElapsedMilliseconds < 19000) lease.Restart();
        else Stop();
    }}
    public static void Stop() { lock (gate) {
        if (timer != null) { timer.Dispose(); timer = null; }
        if (child != null) { try { if (!child.HasExited) child.Kill(); } finally { child = null; } }
    }}
}
'@
}

function Start-ChannelRelay($Bootstrap) {
    Write-Host "FrankerzSpam Channel relay v$($Bootstrap.relayVersion)"
    if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or -not [Environment]::Is64BitOperatingSystem) {
        throw 'This download requires 64-bit Windows with x64 application support.'
    }
    Add-Type -AssemblyName System.Net.Http
    Add-RelayGuard
    [RelayGuard]::AttachConsole()
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $directory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FrankerzSpam\ChannelRelay'
    [void][IO.Directory]::CreateDirectory($directory)
    $unique = [Security.Cryptography.SHA256]::Create()
    try { $stateKey = [BitConverter]::ToString($unique.ComputeHash([Text.Encoding]::UTF8.GetBytes($Bootstrap.origin + '/' + $Bootstrap.ticket))).Replace('-', '') }
    finally { $unique.Dispose() }
    $stateFile = Join-Path $directory ($stateKey + '.credential')
    $mutex = [Threading.Mutex]::new($false, 'Local\FrankerzSpamChannelRelay')
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { $mutex.Dispose(); throw 'A Channel relay is already running in this Windows session.' }
    $cloud = New-RelayHttpClient $false 8
    $local = New-RelayHttpClient $true 12
    try {
        $credential = Get-RelayCredential $cloud $Bootstrap $stateFile
        $exe = Install-RelayMediaServer $directory
        $poll = $Bootstrap.origin + '/api/relay/poll'
        Write-Host 'Relay running. Keep this window open. Close it or press Ctrl+C to stop.'
        while ($true) {
            $password = [guid]::NewGuid().ToString('N')
            $localAuth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('relay:' + $password))
            $child = Start-RelayMediaServer $exe $directory $Bootstrap.sourceUrl $credential $password
            [RelayGuard]::Watch($child)
            $sessions = @{}
            $replies = @()
            $instance = [guid]::NewGuid().ToString()
            try {
                $ready = $false
                for ($attempt = 0; $attempt -lt 25 -and -not $child.HasExited; $attempt++) {
                    try { $null = Get-RelaySessions $local $localAuth $sessions; $ready = $true; break }
                    catch { Start-Sleep -Milliseconds 200 }
                }
                if (-not $ready) { throw 'Cannot start the local relay. Check that ports 28189, 28889 and 29997 are available.' }
                while (-not $child.HasExited) {
                    try { $active = @(Get-RelaySessions $local $localAuth $sessions) }
                    catch { break }
                    $payload = @{ instanceId = $instance; sessions = $active; replies = $replies } | ConvertTo-Json -Compress -Depth 6
                    try { $response = Invoke-RelayHttp $cloud POST $poll ('Bearer ' + $credential) $payload 'application/json' }
                    catch { Start-Sleep -Seconds 1; continue }
                    if ($response.status -in 401,403) {
                        Remove-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue
                        throw 'Relay access ended. Download a fresh relay from your Channel page to pair again.'
                    }
                    if ($response.status -ne 200) { Start-Sleep -Seconds 1; continue }
                    $message = $response.body | ConvertFrom-Json
                    if ($message.reset -eq $true) { break }
                    [RelayGuard]::Renew()
                    if ($child.HasExited) { break }
                    $replies = @()
                    try {
                        foreach ($command in $message.commands) {
                            if ($child.HasExited) { break }
                            $replies += Invoke-RelayCommand $local $localAuth $sessions $command
                        }
                    } catch {
                        # A lost POST response or failed DELETE can leave a peer. Restart to close it.
                        break
                    }
                    if ($replies.Count -eq 0) { Start-Sleep -Milliseconds 1200 }
                }
            } finally {
                [RelayGuard]::Stop()
                [void]$child.WaitForExit(3000)
                $child.Dispose()
            }
            Start-Sleep -Seconds 1
        }
    } finally {
        $local.Dispose(); $cloud.Dispose()
        $mutex.ReleaseMutex(); $mutex.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    $bootstrap = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RELAY_BOOTSTRAP__')) | ConvertFrom-Json
    Start-ChannelRelay $bootstrap
}
