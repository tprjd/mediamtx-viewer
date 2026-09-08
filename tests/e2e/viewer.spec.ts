import { expect, test } from '@playwright/test'

test('shows the channel directory', async ({ page }) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'What are we watching?' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'All channels' })).toBeVisible()
  const card = page.getByRole('link', { name: /Watch Live stream by power/ })
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL('/watch/live')
  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()
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
  const header = await page.getByRole('banner').boundingBox()
  expect(header).not.toBeNull()
  expect(header!.height).toBeGreaterThanOrEqual(48)
  expect(header!.height).toBeLessThanOrEqual(52)
})

test('opens a stable watch URL', async ({ page }) => {
  await page.goto('/watch/live')

  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()
  const player = page.getByLabel('Live stream live video')
  await expect(player).toBeVisible()
  await expect(
    player.getByRole('button', { name: 'Play video' }),
  ).toBeAttached()
  await expect(
    player.getByRole('button', { name: 'Unmute video' }),
  ).toBeAttached()
  await expect(player.getByRole('button', { name: 'Live' })).toBeAttached()
  await expect(player.locator('video[controls]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Low \(best-possible\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Balanced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Smooth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Low latency' })).toBeVisible()
})

test('switches to another live channel from the live rail', async ({ page }) => {
  await page.goto('/watch/live')

  const liveLinks = page
    .getByRole('complementary', { name: 'Live channels' })
    .getByRole('link')
  const liveChannelCount = await liveLinks.count()
  test.skip(
    liveChannelCount < 2,
    'The browser fixture needs at least two live channels for navigation coverage.',
  )

  const targetHref = await liveLinks.nth(1).getAttribute('href')
  expect(targetHref).not.toBeNull()
  await liveLinks.nth(1).click()
  await expect(page).toHaveURL(new URL(targetHref!, page.url()).toString())
})

test('hides fullscreen controls, protocol badge, and cursor when idle', async ({
  page,
}) => {
  await page.goto('/watch/live')

  const player = page.locator('.media-player')
  const controls = player.locator('.media-controls')
  await player.evaluate((element) => {
    element.setAttribute('data-fullscreen', '')
    const button = element.querySelector<HTMLButtonElement>(
      '[aria-label="Enter fullscreen"]',
    )
    button?.focus()
    element.querySelector('.media-controls')?.removeAttribute('data-visible')

    const badge = document.createElement('span')
    badge.className = 'protocol-badge'
    badge.textContent = 'HLS · Balanced'
    element.append(badge)
  })

  await expect(controls).toHaveCSS('opacity', '0')
  await expect(player.locator('.protocol-badge')).toHaveCSS('opacity', '0')
  await expect(player).toHaveCSS('cursor', 'none')

  await controls.evaluate((element) => element.setAttribute('data-visible', ''))

  await expect(controls).toHaveCSS('opacity', '1')
  await expect(player.locator('.protocol-badge')).toHaveCSS('opacity', '1')
  await expect(player).not.toHaveCSS('cursor', 'none')
})

test('keeps all playback modes usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto('/watch/live')

  await expect(page.getByRole('button', { name: /Low \(best-possible\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Balanced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Smooth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Low latency' })).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Live channels' }),
  ).toBeHidden()
  await expect(
    page.locator('.playback-summary-stat').filter({ hasText: 'Live latency' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show playback diagnostics' }).click()
  await expect(
    page.locator('.playback-stats').getByText('Live latency'),
  ).toBeVisible()
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
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

test('uses a compact full-width header that stays at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')

  const header = page.getByRole('banner')
  const brand = page.getByRole('link', { name: 'FrankerzSpam home' })
  await expect(header).toBeVisible()
  await expect(brand).toBeVisible()
  await expect(page.getByRole('search')).toHaveCount(0)

  const beforeScroll = await header.boundingBox()
  expect(beforeScroll).not.toBeNull()
  expect(beforeScroll!.x).toBe(0)
  expect(beforeScroll!.width).toBe(1440)
  expect(beforeScroll!.height).toBeGreaterThanOrEqual(48)
  expect(beforeScroll!.height).toBeLessThanOrEqual(52)

  await page.evaluate(() => {
    document.body.style.minHeight = '200vh'
    window.scrollTo(0, document.body.scrollHeight)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  const afterScroll = await header.boundingBox()
  expect(afterScroll).not.toBeNull()
  expect(afterScroll!.y).toBe(0)
})

test('matches the shared desktop application frame', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop frame uses the Chromium baseline.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()

  await expect(page.locator('.app-shell')).toHaveScreenshot(
    'shared-desktop-application-frame.png',
    { stylePath: 'tests/e2e/screenshot.css' },
  )
})

test('shows Channel-owner and administrator header actions', async ({ page }) => {
  await page.goto('/login?returnTo=/')
  await page.getByLabel('Username').fill('power')
  await page.getByLabel('Password').fill('e2e-administrator-password')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('link', { name: 'My channel' })).toBeVisible()
  const accountControl = page.getByRole('button', {
    name: 'Open account menu for power',
  })
  await expect(accountControl).toHaveText('P')
  await accountControl.click()
  await expect(page.getByRole('menuitem', { name: 'Statistics' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(accountControl).toBeFocused()
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
  await page.getByRole('button', { name: 'Open account menu for power' }).click()
  await expect(page.getByRole('menuitem', { name: 'Admin' })).toBeVisible()
  await expect(page.getByText('/watch/live')).toBeVisible()

  await page.goto('/statistics')
  await expect(page.getByRole('heading', { name: 'Oracle usage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Unknown' })).toBeVisible()
  await expect(
    page.getByText('This local deployment has Oracle statistics disabled.'),
  ).toBeVisible()
  await expect(page.getByText('OCI billing data is unavailable')).toBeVisible()
  const statisticsSizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(statisticsSizes.scrollWidth).toBeLessThanOrEqual(statisticsSizes.clientWidth)

  await page.goto('/account/channel')
  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()

  const eventChannelCount = await page.evaluate<number>(() =>
    new Promise((resolve, reject) => {
      const source = new EventSource('/api/channel-events')
      const timeout = window.setTimeout(() => {
        source.close()
        reject(new Error('Timed out waiting for channel status snapshot'))
      }, 5_000)
      source.addEventListener('snapshot', (event) => {
        window.clearTimeout(timeout)
        source.close()
        const data = JSON.parse((event as MessageEvent<string>).data) as {
          channels: unknown[]
        }
        resolve(data.channels.length)
      })
      source.addEventListener('error', () => {
        window.clearTimeout(timeout)
        source.close()
        reject(new Error('Channel status event stream failed'))
      })
    }),
  )
  expect(eventChannelCount).toBeGreaterThan(0)

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Profile name' })).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('power')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Name updated.')).toBeVisible()

  await page.goto('/account/channel')
  await expect(
    page.getByRole('heading', { name: 'Windows OBS setup' }),
  ).toBeVisible()
  const channelTitle = page.getByRole('heading', { name: 'Live stream' })
  const channelHeading = page.locator('section').filter({ has: channelTitle }).first()
  const channelTitleBox = await channelTitle.boundingBox()
  const channelIconBox = await channelHeading.locator(':scope > svg').boundingBox()
  expect(channelTitleBox).not.toBeNull()
  expect(channelIconBox).not.toBeNull()
  expect(channelIconBox!.y).toBeLessThan(channelTitleBox!.y + channelTitleBox!.height)
  expect(channelIconBox!.y + channelIconBox!.height).toBeGreaterThan(channelTitleBox!.y)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download Windows setup' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Setup-FrankerzSpam-OBS.cmd')
  const downloadStream = await download.createReadStream()
  const downloadChunks: Buffer[] = []
  for await (const chunk of downloadStream) {
    downloadChunks.push(Buffer.from(chunk))
  }
  const launcher = Buffer.concat(downloadChunks).toString('ascii')
  expect(launcher.startsWith('@echo off\r\n')).toBe(true)
  expect(launcher).toContain('-ExecutionPolicy RemoteSigned')
  expect(launcher).not.toContain('-ExecutionPolicy Bypass')

  page.once('dialog', (dialog) => dialog.accept())
  await page
    .getByRole('button', { name: /(?:Generate|Rotate) stream key/ })
    .click()
  await expect(page.getByText('Copy this key now. It will not be shown again.')).toBeVisible()
  await expect(page.locator('.stream-key-reveal code')).toContainText('mtx_sk_')
})
