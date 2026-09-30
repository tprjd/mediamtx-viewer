import testGroups from './test-groups.json' with { type: 'json' }

export const verificationCommands = [
  ['lint', 'npm', ['run', 'lint']],
  ['type', 'npm', ['run', 'typecheck']],
  ['browser', 'npx', ['playwright', 'test', '--workers=2']],
  ['test', 'npm', ['test', '--', '--reporter=verbose', '--bail=1']],
  ['restore', 'npm', ['run', 'chat:restore-drill']],
  ['build', 'npm', ['run', 'build', '--', '--webpack']],
  ['streaming-contract', 'npm', ['run', 'validate:streaming-contract']],
  ['deployment', 'node', ['scripts/validate-chat-deployment.mjs']],
]

export const requiredChecks = verificationCommands.map(([name]) => name)

const command = name => verificationCommands.find(([key]) => key === name)

// Every test partition must pass before the complete "test" check passes.
export const verificationGroups = {
  static: { commands: ['lint', 'type', 'streaming-contract'].map(command), tools: [] },
  unit: { commands: [['test', 'npm', ['run', 'test:fast', '--', '--reporter=verbose', '--bail=1']]], tools: [] },
  browser: { commands: [command('browser')], tools: ['docker', 'chromium'] },
  restore: { commands: [command('restore')], tools: ['docker', 'chromium'] },
  build: { commands: [command('build')], tools: [] },
  configuration: { commands: [command('deployment')], tools: ['docker'] },
  ...Object.fromEntries(testGroups.docker.map(file => [
    `docker-${file.split('/').at(-1).replace(/\.(?:integration\.)?test\.(?:mjs|ts)$/, '')}`,
    { commands: [['test', 'npm', ['run', 'test:docker', '--', file, '--reporter=verbose', '--bail=1']]],
      tools: file.startsWith('lib/') ? ['docker'] : ['docker', 'age', 'age-keygen', 'sops'] },
  ])),
}
