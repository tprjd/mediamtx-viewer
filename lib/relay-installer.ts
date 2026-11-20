import 'server-only'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const RELAY_INSTALLER_FILENAME = 'Start-FrankerzSpam-Relay.cmd'

export function buildRelayInstaller({ origin, ticket }: { origin: string; ticket: string }): Buffer {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || !/^[A-Za-z0-9_-]{16,256}$/.test(ticket)) {
    throw new Error('Invalid relay pairing configuration.')
  }
  const source = readFileSync(join(process.cwd(), 'scripts', 'windows', 'channel-relay.ps1'), 'utf8')
  const bootstrap = Buffer.from(JSON.stringify({ origin, ticket }), 'utf8').toString('base64')
  const payload = Buffer.from(source.replace('__RELAY_BOOTSTRAP__', bootstrap), 'utf8')
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const marker = ':__CHANNEL_RELAY_PAYLOAD__'
  const run = [
    "$ErrorActionPreference='Stop'",
    '$text=[IO.File]::ReadAllText($env:CHANNEL_RELAY_LAUNCHER)',
    `$offset=$text.LastIndexOf('${marker}',[StringComparison]::Ordinal)`,
    `$bytes=[Convert]::FromBase64String($text.Substring($offset+${marker.length}))`,
    "$hash=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-','')",
    `if($hash -ne '${sha256}'){throw 'Damaged relay download.'}`,
    '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes)))',
  ].join(';')
  return Buffer.from([
    '@echo off', 'setlocal DisableDelayedExpansion', 'title FrankerzSpam Channel relay',
    'set "CHANNEL_RELAY_LAUNCHER=%~f0"',
    `powershell.exe -NoLogo -NoProfile -Command "${run}"`,
    'if errorlevel 1 pause', 'exit /b', marker,
    ...(payload.toString('base64').match(/.{1,76}/g) ?? []), '',
  ].join('\r\n'), 'ascii')
}
