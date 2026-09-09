import { expect, test } from '@playwright/test'

test('shows the Channel directory sections in order and opens a watch page', async ({
  page,
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Channels', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('What are we watching?')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)

  const sections = page.getByRole('main').getByRole('region')
  await expect(sections).toHaveCount(2)
  await expect(sections.nth(0)).toHaveAccessibleName('Live Channels')
  await expect(sections.nth(1)).toHaveAccessibleName('Offline Channels')

  const offlineLinks = sections.nth(1).getByRole('link')
  await expect(offlineLinks).toHaveCount(2)
  await expect(offlineLinks.nth(0)).toHaveAccessibleName(
    /Watch Alpha Channel by Alpha Owner, offline/,
  )
  await expect(offlineLinks.nth(1)).toHaveAccessibleName(
    /Watch Zulu Channel by Zulu Owner, offline/,
  )

  const card = sections
    .nth(0)
    .getByRole('link', { name: /Watch Live stream by power, live/ })
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL('/watch/live')
  await expect(page.getByRole('heading', { name: 'Live stream' })).toBeVisible()
})

test('keeps the watch dashboard inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Channels', exact: true }),
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

test('switches to another live Channel from the Channel rail', async ({ page }) => {
  await page.goto('/watch/live')

  const liveLinks = page
    .getByRole('complementary', { name: 'Channels' })
    .getByRole('region', { name: 'Live Channels' })
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

test('pins the Channel rail and gives its released width to the player', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const header = page.getByRole('banner')
  const rail = page.getByRole('complementary', { name: 'Channels' })
  const player = page.getByLabel('Live stream live video')
  const headerBox = await header.boundingBox()
  const expandedRailBox = await rail.boundingBox()
  const expandedPlayerBox = await player.boundingBox()

  expect(headerBox).not.toBeNull()
  expect(expandedRailBox).not.toBeNull()
  expect(expandedPlayerBox).not.toBeNull()
  expect(expandedRailBox!.x).toBe(0)
  expect(expandedRailBox!.y).toBe(headerBox!.height)
  expect(expandedRailBox!.width).toBeGreaterThanOrEqual(236)
  expect(expandedRailBox!.width).toBeLessThanOrEqual(244)
  expect(expandedRailBox!.height).toBe(900 - headerBox!.height)
  await expect(
    header.getByRole('button', { name: /Channel rail/ }),
  ).toHaveCount(0)

  await page.evaluate(() => {
    const details = document.querySelector<HTMLElement>(
      '[aria-label="Channel information"]',
    )
    if (details) details.style.minHeight = '150vh'
    window.scrollTo(0, document.body.scrollHeight)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect((await rail.boundingBox())!.y).toBe(headerBox!.height)

  await page.getByRole('button', { name: 'Collapse Channel rail' }).click()
  const collapsedRailBox = await rail.boundingBox()
  const collapsedPlayerBox = await player.boundingBox()
  expect(collapsedRailBox).not.toBeNull()
  expect(collapsedPlayerBox).not.toBeNull()
  expect(collapsedRailBox!.width).toBeGreaterThanOrEqual(60)
  expect(collapsedRailBox!.width).toBeLessThanOrEqual(68)
  expect(collapsedPlayerBox!.width).toBeGreaterThan(expandedPlayerBox!.width + 160)

  await page.reload()
  await expect(rail).toHaveAttribute('data-rail-state', 'collapsed')
})

test('collapses the Channel rail at narrower desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/watch/live')

  await expect(
    page.getByRole('complementary', { name: 'Channels' }),
  ).toHaveAttribute('data-rail-state', 'collapsed')
})

test('scrolls a short-height Channel rail without moving the document', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 220 })
  await page.goto('/watch/live')

  const list = page.getByRole('navigation', { name: 'Channel list' })
  const measurements = await list.evaluate((element) => {
    const beforeDocumentScroll = window.scrollY
    element.scrollTop = element.scrollHeight
    return {
      beforeDocumentScroll,
      clientHeight: element.clientHeight,
      documentScroll: window.scrollY,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
    }
  })

  expect(measurements.overflowY).toBe('auto')
  expect(measurements.scrollHeight).toBeGreaterThan(measurements.clientHeight)
  expect(measurements.scrollTop).toBeGreaterThan(0)
  expect(measurements.documentScroll).toBe(measurements.beforeDocumentScroll)
})

test('matches expanded and collapsed desktop watch states', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop watch uses the Chromium baseline.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const main = page.getByRole('main')
  await expect(main).toHaveScreenshot('desktop-watch-expanded.png', {
    mask: [page.locator('video')],
    stylePath: 'tests/e2e/screenshot.css',
  })

  await page.getByRole('button', { name: 'Collapse Channel rail' }).click()
  await expect(main).toHaveScreenshot('desktop-watch-collapsed.png', {
    mask: [page.locator('video')],
    stylePath: 'tests/e2e/screenshot.css',
  })
})

test('hides fullscreen controls, protocol badge, and cursor when idle', async ({
  page,
}) => {
  await page.goto('/watch/live')

  const player = page.getByLabel('Live stream live video')
  const controls = player.getByRole('group')
  await player.evaluate((element) => {
    element.setAttribute('data-fullscreen', '')
    const button = element.querySelector<HTMLButtonElement>(
      '[aria-label="Enter fullscreen"]',
    )
    button?.focus()
    element.querySelector('[role="group"]')?.removeAttribute('data-visible')

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
    page.getByRole('complementary', { name: 'Channels' }),
  ).toBeHidden()
  await expect(
    page
      .getByRole('button', { name: 'Show playback diagnostics' })
      .getByText('Live latency'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Show playback diagnostics' }).click()
  await expect(
    page.getByLabel('Playback diagnostics').getByText('Live latency').last(),
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

test('matches the desktop Channel directory', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Desktop directory uses the Chromium baseline.',
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Live Channels' })).toBeVisible()

  await expect(page.getByRole('main')).toHaveScreenshot(
    'desktop-channel-directory.png',
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
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The administrator flow mutates the shared browser-test database.',
  )
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

  await page
    .getByRole('button', { name: /(?:Generate|Rotate) stream key/ })
    .click()
  const rotationDialog = page.getByRole('dialog', { name: 'Rotate stream key?' })
  if (await rotationDialog.isVisible()) {
    await rotationDialog.getByRole('button', { name: 'Rotate key' }).click()
  }
  await expect(
    page.getByText('Paste these into OBS. They are shown only once.'),
  ).toBeVisible()
  await expect(page.getByText(/^mtx_sk_[A-Za-z0-9_-]+$/)).toBeVisible()
})
