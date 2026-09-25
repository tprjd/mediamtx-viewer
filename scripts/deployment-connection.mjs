import { execFileSync } from 'node:child_process'

import { readFileSync } from 'node:fs'
export const ownerProgram = readFileSync(new URL('./deployment-owner.mjs', import.meta.url), 'utf8')

let owner
export function setDeploymentOwner(value) { owner = value }
// A Docker/Compose client can outlive its workstation parent. Its extra file
// descriptor keeps the connection lock held until that in-flight command exits.
export function deploymentStdio() { return ['ignore', 'pipe', 'pipe', ...(owner ? [owner.input] : [])] }
export function assertDeploymentOwner(args) {
  if (!owner) return
  // Read-only Docker requests cannot advance an abandoned attempt. Check the
  // connection before every request that can change host state.
  let index = 0
  while (['--host', '--config'].includes(args?.[index])) index += 2
  const command = args?.[index]
  if (['ps', 'inspect', 'info', 'context', 'logs', 'wait'].includes(command) ||
      ['image', 'volume'].includes(command) && args[index + 1] === 'inspect') return
  try {
    execFileSync('docker', ['exec', owner.tool, 'node', '--input-type=module', '-e', ownerProgram, 'check', owner.token],
      { stdio: deploymentStdio(), timeout: 10000 })
  } catch { throw new Error('Managed operation connection is no longer the owner') }
}
