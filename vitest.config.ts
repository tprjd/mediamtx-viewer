import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import testGroups from './scripts/test-groups.json' with { type: 'json' }

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const suite = process.env.TEST_SUITE
if (suite && !['fast', 'docker'].includes(suite)) {
  throw new Error(`Unknown TEST_SUITE: ${suite}. Use fast or docker, or omit it for all tests.`)
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': projectRoot,
    },
  },
  test: {
    environment: 'jsdom',
    ...(suite === 'docker' ? { include: testGroups.docker, maxWorkers: 2 } : {}),
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', '.data/**',
      ...(suite === 'fast' ? testGroups.docker : [])],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
