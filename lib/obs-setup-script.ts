import 'server-only'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OBS_SETUP_SCRIPT_VERSION } from '@/lib/obs-setup'

export const OBS_SETUP_SCRIPT_FILENAME = 'Setup-FrankerzSpam-OBS.cmd'
export const OBS_SETUP_PAYLOAD_MARKER = ':__FRANKERZSPAM_POWERSHELL_PAYLOAD__'

function scriptPath(): string {
  return join(
    process.cwd(),
    'scripts',
    'windows',
    'setup-frankerzspam-obs.ps1',
  )
}
export function readObsSetupPowerShellSource(): Buffer {
  return readFileSync(scriptPath())
}

export function buildObsSetupLauncher(): Buffer {
  const payload = readObsSetupPowerShellSource()
  const payloadSha256 = createHash('sha256').update(payload).digest('hex')
  const encodedPayload = payload
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') ?? ''
  const extractionCommand = [
    "$ErrorActionPreference='Stop'",
    'try {',
    '$raw=[IO.File]::ReadAllText($env:FRANKERZSPAM_LAUNCHER)',
    `$marker='${OBS_SETUP_PAYLOAD_MARKER}'`,
    '$offset=$raw.LastIndexOf($marker,[StringComparison]::Ordinal)',
    "if($offset -lt 0){throw 'Embedded setup payload is missing.'}",
    '$encoded=$raw.Substring($offset+$marker.Length)',
    '$bytes=[Convert]::FromBase64String($encoded)',
    '$sha=[Security.Cryptography.SHA256]::Create()',
    "try{$actual=[BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}",
    `if($actual -ne '${payloadSha256}'){throw 'Embedded setup payload checksum mismatch.'}`,
    '[IO.File]::WriteAllBytes($env:FRANKERZSPAM_PAYLOAD,$bytes)',
    'Unblock-File -LiteralPath $env:FRANKERZSPAM_PAYLOAD',
    '} catch {',
    "Write-Host ('Launcher validation failed: '+$_.Exception.Message) -ForegroundColor Red",
    'exit 1',
    '}',
  ].join(';')
  const launcher = [
    '@echo off',
    'setlocal EnableExtensions',
    'title FrankerzSpam OBS setup',
    'set "FRANKERZSPAM_LAUNCHER=%~f0"',
    'set "FRANKERZSPAM_PAYLOAD=%TEMP%\\FrankerzSpam-OBS-%RANDOM%-%RANDOM%.ps1"',
    'where powershell.exe >nul 2>&1',
    'if errorlevel 1 (',
    '  echo Windows PowerShell was not found.',
    '  pause',
    '  exit /b 1',
    ')',
    `powershell.exe -NoLogo -NoProfile -Command "${extractionCommand}"`,
    'if errorlevel 1 (',
    '  del /q "%FRANKERZSPAM_PAYLOAD%" >nul 2>&1',
    '  echo.',
    '  echo The setup launcher could not verify its embedded payload.',
    '  pause',
    '  exit /b 1',
    ')',
    'rem RemoteSigned applies only to this child PowerShell process.',
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%FRANKERZSPAM_PAYLOAD%" %*',
    'set "FRANKERZSPAM_EXIT_CODE=%ERRORLEVEL%"',
    'del /q "%FRANKERZSPAM_PAYLOAD%" >nul 2>&1',
    'if not "%FRANKERZSPAM_EXIT_CODE%"=="0" (',
    '  echo.',
    '  echo Setup did not finish successfully. Review the message above.',
    '  pause',
    ')',
    'exit /b %FRANKERZSPAM_EXIT_CODE%',
    OBS_SETUP_PAYLOAD_MARKER,
    encodedPayload,
    '',
  ].join('\r\n')
  return Buffer.from(launcher, 'ascii')
}

export function getObsSetupScriptMetadata(): {
  version: string
  sha256: string
  size: number
} {
  const script = buildObsSetupLauncher()
  return {
    version: OBS_SETUP_SCRIPT_VERSION,
    sha256: createHash('sha256').update(script).digest('hex'),
    size: script.byteLength,
  }
}
