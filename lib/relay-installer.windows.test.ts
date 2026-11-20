// @vitest-environment node
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildRelayInstaller, RELAY_INSTALLER_FILENAME } from './relay-installer'

it.runIf(process.platform === 'win32' && process.env.RELAY_WINDOWS_SMOKE === '1')(
  'pairs the downloadable .cmd once, stops its child, and resumes with Windows user credentials',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay launcher '))
    const fixtureEnv = { ...process.env, RELAY_TEST_DIR: dir }
    function powershell(script: string) {
      return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', "$ErrorActionPreference='Stop'; " + script], {
        encoding: 'utf8', env: fixtureEnv, timeout: 30_000,
      }).trim()
    }
    const pfxPassword = 'local-fixture'
    let thumbprint = ''
    const ticket = 'mtx_rp_' + randomBytes(32).toString('base64url')
    const credential = 'mtx_rc_' + randomBytes(32).toString('base64url')
    const instances = new Set<string>()
    let pairCalls = 0
    let revoke = false
    let launcher: ChildProcess | undefined
    let output = ''
    let stateFile = ''
    let server: ReturnType<typeof createServer> | undefined

    function launch() {
      output = ''
      launcher = spawn('cmd.exe', ['/d', '/c', RELAY_INSTALLER_FILENAME], {
        cwd: dir, env: fixtureEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
      launcher.stdout!.on('data', chunk => { output += chunk.toString() })
      launcher.stderr!.on('data', chunk => { output += chunk.toString() })
      // Leave no interactive pause if the launcher exits with an error.
      launcher.stdin!.end()
    }
    async function waitUntil(check: () => boolean, description: string) {
      for (let i = 0; i < 200; i++) {
        if (check()) return
        if (launcher?.exitCode != null) break
        await sleep(100)
      }
      // Only diagnostics from this disposable local fixture, never credentials or SDP.
      const diagnostic = output.replaceAll(credential, '[redacted]').replaceAll(ticket, '[redacted]')
      throw new Error(description + '\n' + diagnostic)
    }

    try {
      thumbprint = powershell([
        "$cert=New-SelfSignedCertificate -DnsName localhost -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1)",
        "$cer=Join-Path $env:RELAY_TEST_DIR cert.cer",
        'Export-Certificate -Cert $cert -FilePath $cer | Out-Null',
        'Import-Certificate -FilePath $cer -CertStoreLocation Cert:\\CurrentUser\\Root | Out-Null',
        `Export-PfxCertificate -Cert $cert -FilePath (Join-Path $env:RELAY_TEST_DIR cert.pfx) -Password (ConvertTo-SecureString '${pfxPassword}' -AsPlainText -Force) | Out-Null`,
        '$cert.Thumbprint',
      ].join('; '))
      expect(thumbprint).toMatch(/^[0-9a-f]{40}$/i)
      server = createServer({ pfx: await readFile(join(dir, 'cert.pfx')), passphrase: pfxPassword }, async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        response.setHeader('Content-Type', 'application/json')
        if (request.method === 'POST' && request.url === '/api/relay/pair' && body.ticket === ticket && ++pairCalls === 1) {
          return response.end(JSON.stringify({ credential }))
        }
        if (request.method === 'POST' && request.url === '/api/relay/poll' && request.headers.authorization === 'Bearer ' + credential && !revoke) {
          instances.add(body.instanceId)
          return response.end(JSON.stringify({ commands: [] }))
        }
        response.writeHead(403).end('{}')
      })
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const origin = 'https://localhost:' + (server.address() as AddressInfo).port
      await writeFile(join(dir, RELAY_INSTALLER_FILENAME), buildRelayInstaller({ origin, ticket }))
      const stateKey = createHash('sha256').update(origin + '/' + ticket).digest('hex').toUpperCase()
      stateFile = join(process.env.LOCALAPPDATA!, 'FrankerzSpam', 'ChannelRelay', stateKey + '.credential')

      launch()
      await waitUntil(() => instances.size === 1, 'First launcher did not authenticate its control connection.')
      expect(await readFile(stateFile, 'utf8')).not.toContain(credential)
      const pid = launcher!.pid!
      const mediaPid = powershell([
        `$control=Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid} AND Name='powershell.exe'"`,
        '$media=Get-CimInstance Win32_Process -Filter ("ParentProcessId="+$control.ProcessId+" AND Name=\'mediamtx-1.20.1.exe\'")',
        "if (-not $media) { throw 'Missing Windows media child.' }",
        'Stop-Process -Id $control.ProcessId -Force',
        '$media.ProcessId',
      ].join('; '))
      expect(mediaPid).toMatch(/^\d+$/)
      expect(powershell(`$p=Get-Process -Id ${mediaPid} -ErrorAction SilentlyContinue; if ($p) { $p.WaitForExit(5000) } else { $true }`)).toBe('True')
      await vi.waitFor(() => expect(launcher!.exitCode).not.toBeNull(), { timeout: 5000 })
      launch()
      await waitUntil(() => instances.size === 2, 'Relaunch could not read the DPAPI credential.')
      expect(pairCalls).toBe(1)
      revoke = true
      await vi.waitFor(() => expect(launcher!.exitCode).not.toBeNull(), { timeout: 8000 })
      await expect(readFile(stateFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (launcher?.pid && launcher.exitCode === null) {
        try { execFileSync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* Already stopped. */ }
      }
      server?.closeAllConnections()
      server?.close()
      if (stateFile) await rm(stateFile, { force: true })
      if (/^[0-9a-f]{40}$/i.test(thumbprint)) {
        powershell(`Remove-Item -LiteralPath 'Cert:\\CurrentUser\\Root\\${thumbprint}', 'Cert:\\CurrentUser\\My\\${thumbprint}'`)
      }
      await rm(dir, { recursive: true, force: true })
    }
  }, 100_000,
)
