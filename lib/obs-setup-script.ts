import 'server-only'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OBS_SETUP_SCRIPT_VERSION } from '@/lib/obs-setup'

export const OBS_SETUP_SCRIPT_FILENAME = 'Setup-FrankerzSpam-OBS.ps1'

function scriptPath(): string {
  return join(
    process.cwd(),
    'scripts',
    'windows',
    'setup-frankerzspam-obs.ps1',
  )
}
export function readObsSetupScript(): Buffer {
  return readFileSync(scriptPath())
}

export function getObsSetupScriptMetadata(): {
  version: string
  sha256: string
  size: number
} {
  const script = readObsSetupScript()
  return {
    version: OBS_SETUP_SCRIPT_VERSION,
    sha256: createHash('sha256').update(script).digest('hex'),
    size: script.byteLength,
  }
}
