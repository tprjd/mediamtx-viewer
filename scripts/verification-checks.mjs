export const verificationCommands = [
  ['lint', 'npm', ['run', 'lint']],
  ['type', 'npm', ['run', 'typecheck']],
  ['test', 'npm', ['test', '--', '--reporter=verbose']],
  ['browser', 'npx', ['playwright', 'test', '--workers=2']],
  ['restore', 'npm', ['run', 'chat:restore-drill']],
  ['build', 'npm', ['run', 'build', '--', '--webpack']],
  ['streaming-contract', 'npm', ['run', 'validate:streaming-contract']],
  ['deployment', 'node', ['scripts/validate-chat-deployment.mjs']],
]

export const requiredChecks = verificationCommands.map(([name]) => name)
