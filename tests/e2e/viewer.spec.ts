import { createRequire } from 'node:module'

import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }

const appVersion = `v${packageJson.version}`

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

test('pins the home Channel rail and shares its saved preference with watch pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const header = page.getByRole('banner')
  const rail = page.getByRole('complementary', { name: 'Channels' })
  const directory = page
    .getByRole('main')
    .getByRole('region', { name: 'Live Channels' })
    .last()
  const headerBox = await header.boundingBox()
  const expandedRailBox = await rail.boundingBox()
  const expandedDirectoryBox = await directory.boundingBox()

  expect(headerBox).not.toBeNull()
  expect(expandedRailBox).not.toBeNull()
  expect(expandedDirectoryBox).not.toBeNull()
  expect(expandedRailBox!.x).toBe(0)
  expect(expandedRailBox!.y).toBe(headerBox!.height)
  expect(expandedRailBox!.width).toBeGreaterThanOrEqual(236)
  expect(expandedRailBox!.width).toBeLessThanOrEqual(244)
  expect(expandedRailBox!.height).toBe(900 - headerBox!.height)
  expect(expandedDirectoryBox!.x).toBeGreaterThanOrEqual(
    expandedRailBox!.x + expandedRailBox!.width,
  )

  await page.getByRole('button', { name: 'Collapse Channel rail' }).click()
  const collapsedRailBox = await rail.boundingBox()
  const collapsedDirectoryBox = await directory.boundingBox()
  expect(collapsedRailBox).not.toBeNull()
  expect(collapsedDirectoryBox).not.toBeNull()
  expect(collapsedRailBox!.width).toBeGreaterThanOrEqual(60)
  expect(collapsedRailBox!.width).toBeLessThanOrEqual(68)
  expect(collapsedDirectoryBox!.width).toBeGreaterThan(
    expandedDirectoryBox!.width,
  )

  await page.goto('/watch/live')
  await expect(
    page.getByRole('complementary', { name: 'Channels' }),
  ).toHaveAttribute('data-rail-state', 'collapsed')

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
})

test('opens accessible Channel drawers on narrow home and watch pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')

  const trigger = page.getByRole('button', { name: 'Open Channel drawer' })
  await expect(trigger).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Channels' }),
  ).toBeHidden()

  await trigger.click()
  let drawer = page.getByRole('dialog', { name: 'Channels' })
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByRole('heading', { name: 'Live Channels' }),
  ).toBeVisible()
  await expect(
    drawer.getByRole('heading', { name: 'Other Channels' }),
  ).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  drawer = page.getByRole('dialog', { name: 'Channels' })
  await drawer
    .getByRole('link', { name: /Watch Live stream by power, live/ })
    .click()
  await expect(page).toHaveURL('/watch/live')
  await expect(drawer).toBeHidden()

  await page.getByRole('button', { name: 'Open Channel drawer' }).click()
  drawer = page.getByRole('dialog', { name: 'Channels' })
  await expect(
    drawer.getByRole('link', { name: /Watch Live stream by power, live/ }),
  ).toHaveAttribute('aria-current', 'page')

  const focusedElementStaysInDrawer = await drawer.evaluate((element) =>
    element.contains(document.activeElement),
  )
  expect(focusedElementStaysInDrawer).toBe(true)

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
})

test('matches the mobile Channel drawer', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The mobile Channel drawer uses the Chromium baseline.',
  )
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/watch/live')
  await page.getByRole('button', { name: 'Open Channel drawer' }).click()

  await expect(page.getByRole('dialog', { name: 'Channels' })).toHaveScreenshot(
    'mobile-channel-drawer.png', {
    stylePath: 'tests/e2e/screenshot.css',
    },
  )
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
  const settings = page.getByRole('button', {
    name: 'Show playback settings',
  })
  await expect(settings).toBeVisible()
  await expect(page.getByRole('button', { name: 'Balanced' })).toHaveCount(0)

  await settings.click()
  await expect(
    page.getByRole('button', { name: 'Hide playback settings' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Low \(best-possible\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Balanced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Smooth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Low latency' })).toBeVisible()
})

test('keeps the selected playback mode when settings closes and reopens', async ({
  page,
}) => {
  await page.goto('/watch/live')

  await page.getByRole('button', { name: 'Show playback settings' }).click()
  const smooth = page.getByRole('button', { name: 'Smooth' })
  await smooth.click()
  await expect(smooth).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Hide playback settings' }).click()
  await expect(page.getByRole('button', { name: 'Show playback settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Show playback settings' }).click()

  await expect(page.getByRole('button', { name: 'Smooth' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('pins live chat to the right edge while the center column scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const header = page.getByRole('banner')
  const chat = page.getByRole('complementary', { name: 'Chat placeholder' })
  const player = page.getByLabel('Live stream live video')
  const headerBox = await header.boundingBox()
  const chatBox = await chat.boundingBox()
  const playerBox = await player.boundingBox()

  expect(headerBox).not.toBeNull()
  expect(chatBox).not.toBeNull()
  expect(playerBox).not.toBeNull()
  expect(chatBox!.x + chatBox!.width).toBe(1440)
  expect(chatBox!.width).toBeGreaterThanOrEqual(338)
  expect(chatBox!.width).toBeLessThanOrEqual(342)
  expect(chatBox!.y).toBe(headerBox!.height)
  expect(chatBox!.height).toBe(900 - headerBox!.height)
  expect(playerBox!.width).toBeGreaterThan(0)
  await expect(chat.getByText('Chat is coming soon')).toBeVisible()
  await expect(chat.getByRole('textbox', { name: 'Chat message' })).toBeDisabled()

  await page.evaluate(() => {
    const details = document.querySelector<HTMLElement>(
      '[aria-label="Channel information"]',
    )
    if (details) details.style.minHeight = '150vh'
    window.scrollTo(0, document.body.scrollHeight)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  expect((await chat.boundingBox())!.y).toBe(headerBox!.height)
})

test('closes and restores chat without leaving an empty player column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const player = page.getByLabel('Live stream live video')
  const openPlayerBox = await player.boundingBox()
  expect(openPlayerBox).not.toBeNull()

  await page.getByRole('button', { name: 'Close Chat' }).click()
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Chat' })).toBeVisible()
  const closedPlayerBox = await player.boundingBox()
  expect(closedPlayerBox).not.toBeNull()
  expect(closedPlayerBox!.width).toBeGreaterThan(openPlayerBox!.width + 300)
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('home-stream.chat-preference')))
    .toBe('closed')

  await page.goto('/')
  await page.goto('/watch/live')
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open Chat' })).toBeVisible()

  await page.getByRole('button', { name: 'Open Chat' }).click()
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toBeVisible()
})

test('enters theater mode, reallocates chat width, and resets on reload or Channel navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const main = page.getByRole('main')
  const header = page.getByRole('banner')
  const rail = page.getByRole('complementary', { name: 'Channels' })
  const details = page.getByRole('region', { name: 'Channel information' })
  const player = page.getByLabel('Live stream live video')
  const chat = page.getByRole('complementary', { name: 'Chat placeholder' })

  await expect(page.getByRole('contentinfo')).toHaveCount(0)

  await page.getByRole('button', { name: 'Collapse Channel rail' }).click()
  await expect(rail).toHaveAttribute('data-rail-state', 'collapsed')

  const theaterEntry = player.getByRole('button', {
    name: 'Enter theater mode',
  })
  await theaterEntry.click()

  await expect(header).toBeHidden()
  await expect(rail).toBeHidden()
  await expect(details).toBeHidden()
  await expect(chat).toBeVisible()
  await expect(player.getByRole('button', { name: 'Exit theater mode' })).toBeAttached()

  const theaterPlayerBox = await player.boundingBox()
  const theaterChatBox = await chat.boundingBox()
  const theaterMainBox = await main.boundingBox()
  expect(theaterPlayerBox).not.toBeNull()
  expect(theaterChatBox).not.toBeNull()
  expect(theaterMainBox).not.toBeNull()
  expect(theaterMainBox!.x).toBe(0)
  expect(theaterMainBox!.y).toBe(0)
  expect(theaterMainBox!.width).toBe(1440)
  expect(theaterMainBox!.height).toBe(900)
  expect(theaterChatBox!.x + theaterChatBox!.width).toBe(1440)
  expect(theaterChatBox!.y).toBe(0)
  expect(theaterChatBox!.height).toBe(900)
  expect(theaterPlayerBox!.width + theaterChatBox!.width).toBe(1440)

  await page.getByRole('button', { name: 'Close Chat' }).click()
  await expect(chat).toHaveCount(0)
  const closedPlayerBox = await player.boundingBox()
  expect(closedPlayerBox).not.toBeNull()
  expect(closedPlayerBox!.width).toBe(1440)
  const theaterChatRestore = page.locator('[data-theater-chat-restore]')
  await expect(theaterChatRestore).toBeVisible()
  await theaterChatRestore.click()
  await expect(chat).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close Chat' })).toBeFocused()

  await page.getByRole('button', { name: 'Exit theater mode' }).click()
  await expect(header).toBeVisible()
  await expect(rail).toBeVisible()
  await expect(details).toBeVisible()
  await expect(chat).toBeVisible()

  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await page.reload()
  await expect(header).toBeVisible()
  await expect(rail).toBeVisible()
  await expect(details).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Enter theater mode' }),
  ).toBeAttached()

  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await page.goto('/watch/alpha')
  await expect(header).toBeVisible()
  await expect(rail).toBeVisible()
  await expect(details).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toHaveCount(0)
})

test('keeps theater mode inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto('/watch/live')

  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await expect(page.getByRole('banner')).toBeHidden()
  await expect(
    page.getByRole('complementary', { name: 'Chat placeholder' }),
  ).toBeVisible()

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
  expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.clientHeight)

  const chat = page.getByRole('complementary', { name: 'Chat placeholder' })
  const player = page.getByLabel('Live stream live video')
  const chatBox = await chat.boundingBox()
  const playerBox = await player.boundingBox()
  expect(chatBox).not.toBeNull()
  expect(playerBox).not.toBeNull()
  expect(chatBox!.x + chatBox!.width).toBe(320)
  expect(playerBox!.width + chatBox!.width).toBe(320)

  await page.getByRole('button', { name: 'Exit theater mode' }).click()
  const drawerTrigger = page.getByRole('button', {
    name: 'Open Channel drawer',
  })
  await expect(drawerTrigger).toBeVisible()
  await drawerTrigger.click()
  const drawer = page.getByRole('dialog', { name: 'Channels' })
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Enter theater mode' }),
  ).toBeVisible()
})

test('moves live chat below the player at the narrow content breakpoint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/watch/live')

  const chat = page.getByRole('complementary', { name: 'Chat placeholder' })
  const player = page.getByLabel('Live stream live video')
  const chatBox = await chat.boundingBox()
  const playerBox = await player.boundingBox()

  expect(chatBox).not.toBeNull()
  expect(playerBox).not.toBeNull()
  expect(chatBox!.x).toBe(0)
  expect(chatBox!.width).toBe(768)
  expect(chatBox!.y).toBeGreaterThan(playerBox!.y + playerBox!.height)
  const chatToggle = chat.getByRole('button', { name: 'Chat', exact: true })
  await expect(chatToggle).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(chat.getByText('Chat is coming soon')).toBeHidden()

  await chatToggle.click()
  await expect(chatToggle).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(chat.getByText('Chat is coming soon')).toBeVisible()
  await expect(chat.getByRole('textbox', { name: 'Chat message' })).toBeDisabled()

  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
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

test('matches the narrow normal watch state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Narrow watch uses the Chromium baseline.')
  await page.setViewportSize({ width: 768, height: 900 })
  await page.goto('/watch/live')

  await expect(page.getByRole('main')).toHaveScreenshot('narrow-watch.png', {
    mask: [page.locator('video')],
    stylePath: 'tests/e2e/screenshot.css',
  })
})

test('matches open and closed theater watch states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Theater watch uses the Chromium baseline.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/live')

  const main = page.getByRole('main')
  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await expect(main).toHaveScreenshot('theater-watch-open.png', {
    stylePath: 'tests/e2e/screenshot.css',
  })

  await page.getByRole('button', { name: 'Close Chat' }).click()
  await expect(main).toHaveScreenshot('theater-watch-closed.png', {
    stylePath: 'tests/e2e/screenshot.css',
  })
})

test('matches the offline watch state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Offline watch uses the Chromium baseline.')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/watch/alpha')
  await expect(page.getByText('Stream offline')).toBeVisible()

  await expect(page.getByRole('main')).toHaveScreenshot('offline-watch.png', {
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

  await page.getByRole('button', { name: 'Show playback settings' }).click()
  await expect(page.getByRole('button', { name: /Low \(best-possible\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Balanced' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Smooth' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Low latency' })).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Channels' }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Show playback diagnostics' }).getByText(
      'Live latency',
    ),
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

test('keeps an offline watch page inside a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 })
  await page.goto('/watch/alpha')

  await expect(
    page.getByRole('button', { name: 'Open Channel drawer' }),
  ).toBeVisible()
  await expect(page.getByText('Stream offline')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share this stream' })).toBeVisible()
  await expect(page.getByRole('button', { name: /playback settings/i })).toHaveCount(0)
  await expect(page.getByLabel('Playback diagnostics')).toHaveCount(0)
  await expect(page.getByRole('contentinfo')).toHaveCount(0)
  const sizes = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
})

test('does not render a footer on the watch page', async ({ page }) => {
  await page.goto('/watch/alpha')

  await expect(page.getByRole('contentinfo')).toHaveCount(0)
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
  await expect(
    page.getByRole('button', { name: 'Open Channel drawer' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('complementary', { name: 'Channels' }),
  ).toHaveCount(0)
})

test('uses a compact full-width header that stays at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')

  const header = page.getByRole('banner')
  const brand = page.getByRole('link', {
    name: `FrankerzSpam home, version ${packageJson.version}`,
  })
  await expect(header).toBeVisible()
  await expect(brand).toBeVisible()
  await expect(brand.locator('sup')).toHaveText(appVersion)
  await expect(brand.locator('sup')).toHaveCSS('vertical-align', 'super')
  await expect(page.getByRole('contentinfo')).toHaveCount(0)
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
