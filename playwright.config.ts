import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3199',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node scripts/e2e-mediamtx-api.mjs',
      url: 'http://[::1]:3997/v3/paths/list',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'AUTH_DB_PATH=.data/e2e-auth.sqlite npm run auth:migrate && AUTH_DB_PATH=.data/e2e-auth.sqlite ADMIN_USERNAME=power ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=e2e-administrator-password npm run auth:bootstrap && AUTH_DB_PATH=.data/e2e-auth.sqlite E2E_FIXTURES=1 node scripts/bootstrap-e2e-channels.mjs && AUTH_DB_PATH=.data/e2e-auth.sqlite NEXT_DIST_DIR=.next-e2e BETTER_AUTH_URL=http://localhost:3199 BETTER_AUTH_SECRET=e2e-better-auth-secret-at-least-32-characters INTERNAL_AUTH_SECRET=e2e-internal-auth-secret-at-least-32-characters MEDIAMTX_AUTH_SECRET=e2e-mediamtx-auth-secret-at-least-32-characters MEDIAMTX_API_URL=http://[::1]:3997 npm run dev -- --hostname ::1 --port 3199',
      url: 'http://[::1]:3199',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
