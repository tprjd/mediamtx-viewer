#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function mediaMtxDuration(milliseconds) {
  return milliseconds % 1000 === 0
    ? `${milliseconds / 1000}s`
    : `${milliseconds}ms`
}

function topLevelSettings(yaml) {
  const settings = new Map()
  for (const line of yaml.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (match) settings.set(match[1], match[2].replace(/[ \t]+#.*$/, ''))
  }
  return settings
}

export function validateMediaMtxContract(contract, yaml) {
  const packaging = contract?.hls?.packaging
  if (
    contract?.schemaVersion !== 1 ||
    typeof contract?.contractVersion !== 'string' ||
    packaging?.variant !== 'lowLatency' ||
    packaging?.alwaysRemux !== true ||
    !Number.isInteger(packaging?.segmentDurationMs) ||
    !Number.isInteger(packaging?.partDurationMs)
  ) {
    throw new Error('The canonical streaming contract is invalid.')
  }

  const expected = new Map([
    ['hlsVariant', packaging.variant],
    ['hlsAlwaysRemux', String(packaging.alwaysRemux)],
    ['hlsSegmentDuration', mediaMtxDuration(packaging.segmentDurationMs)],
    ['hlsPartDuration', mediaMtxDuration(packaging.partDurationMs)],
  ])
  const actual = topLevelSettings(yaml)
  return [...expected].flatMap(([setting, value]) =>
    actual.get(setting) === value
      ? []
      : [{ setting, expected: value, actual: actual.get(setting) }],
  )
}

function main() {
  const configPath = process.argv[2]
  if (!configPath) {
    console.error('Usage: node scripts/validate-streaming-contract.mjs <mediamtx.yml>')
    process.exitCode = 2
    return
  }

  const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const contractPath = resolve(projectDirectory, 'config/streaming-contract.v1.json')
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  const yaml = readFileSync(resolve(configPath), 'utf8')
  const violations = validateMediaMtxContract(contract, yaml)
  if (violations.length === 0) {
    console.log(`MediaMTX matches streaming contract ${contract.contractVersion}`)
    return
  }

  console.error(`MediaMTX violates streaming contract ${contract.contractVersion}:`)
  for (const violation of violations) {
    console.error(
      `- ${violation.setting}: expected ${violation.expected}, found ${violation.actual ?? 'missing'}`,
    )
  }
  process.exitCode = 1
}

if (
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main()
}
