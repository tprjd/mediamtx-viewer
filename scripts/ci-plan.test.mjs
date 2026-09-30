// @vitest-environment node
import { expect, it } from 'vitest'
import { branchGroups } from './ci-plan.mjs'
import { verificationGroups } from './verification-checks.mjs'

it('runs full verification for unknown inputs and deployment dependencies', () => {
  for (const paths of [undefined, [], ['scripts/stage-release.mjs'], ['package-lock.json'], ['lib/auth/auth.ts'], ['migrations/001.sql'], ['new-input.json'], ['Dockerfile']]) {
    expect(branchGroups(paths)).toEqual(Object.keys(verificationGroups))
  }
})

it('omits only Docker acceptance for known frontend changes and honors full validation', () => {
  const paths = ['components/chat-transcript.tsx', 'tests/e2e/chat.spec.ts']
  expect(branchGroups(paths)).not.toContain('docker')
  expect(branchGroups(paths)).toEqual(expect.arrayContaining(['static', 'unit', 'browser', 'restore', 'build', 'configuration']))
  expect(branchGroups(paths, true)).toEqual(Object.keys(verificationGroups))
})
