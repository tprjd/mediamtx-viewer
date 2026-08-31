import { expect, test } from '@playwright/test'

test('shows the channel directory', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'What are we watching?' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'All channels' })).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Watch Live stream by power/ }),
  ).toBeVisible()
})

test('keeps the watch dashboard inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'What are we watching?' }),
  ).toBeVisible()
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
})

test('opens a stable watch URL', async ({ page }) => {
  await page.goto('/watch/live')

  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()
  await expect(page.getByLabel('Live stream live video')).toBeVisible()
})

test('returns a useful page for unknown channels', async ({ page }) => {
  await page.goto('/watch/not-configured')

  await expect(
    page.getByRole('heading', { name: 'That channel does not exist.' }),
  ).toBeVisible()
})

test('shows username login without a shared browser prompt', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('keeps public registration closed by default', async ({ page }) => {
  await page.goto('/register')

  await expect(
    page.getByRole('heading', { name: 'Registration is closed.' }),
  ).toBeVisible()
})

test('administrator can manage the owned OBS channel and reveal a key once', async ({
  page,
}) => {
  await page.goto('/login?returnTo=/account/channel')
  await page.getByLabel('Username').fill('power')
  await page.getByLabel('Password').fill('e2e-administrator-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'My channel' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  await expect(page.getByText('/watch/live')).toBeVisible()

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Profile name' })).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('power')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Name updated.')).toBeVisible()

  await page.goto('/account/channel')
  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('button', { name: /(?:Generate|Rotate) stream key/ })
    .click()
  await expect(page.getByText('Copy this key now. It will not be shown again.')).toBeVisible()
  await expect(page.locator('.stream-key-reveal code')).toContainText('mtx_sk_')
})
