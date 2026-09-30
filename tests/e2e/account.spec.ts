import { expect, test } from '@playwright/test'

test('administrator can manage the owned OBS channel and reveal a key once', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => Promise.reject(new Error('Clipboard blocked')),
    } })
  })
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
  await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled()
  await page.getByLabel('Name').fill('Updated profile name')
  await expect(page.getByRole('button', { name: 'Save name' })).toBeEnabled()
  await page.getByLabel('Name').fill('power')
  await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled()

  await page.goto('/account/channel')
  await expect(
    page.getByRole('heading', { name: 'Download OBS setup' }),
  ).toBeVisible()
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('[data-site-header]').evaluate(
      element => element.getBoundingClientRect().height,
    )).toBe(50)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expect(page.getByRole('button', { name: 'Save details' })).toHaveCSS('background-color', 'rgb(219, 39, 119)')
    await expect(page.getByRole('button', { name: 'Save details' })).toHaveCSS('color', 'rgb(255, 255, 255)')
    for (const selector of ['[data-site-header]', 'main']) {
      expect(await page.locator(selector).evaluate(element => {
        const style = getComputedStyle(element)
        const root = getComputedStyle(document.documentElement)
        return ['--accent', '--accent-soft', '--panel', '--muted'].every(
          token => style.getPropertyValue(token) === root.getPropertyValue(token),
        )
      })).toBe(true)
    }
    for (const label of ['Title', 'Description']) {
      await expect(page.getByRole('textbox', { name: label, exact: true })).toBeVisible()
    }
    const publishing = await page.getByRole('heading', { name: 'OBS publishing' }).boundingBox()
    const details = await page.getByRole('heading', { name: 'Channel details' }).boundingBox()
    if (width === 1440) expect(details!.y).toBe(publishing!.y)
    else expect(details!.y).toBeGreaterThan(publishing!.y)
    await page.screenshot({ path: testInfo.outputPath(`channel-${width}.png`), fullPage: true })
  }
  await page.getByRole('textbox', { name: 'Title', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toBeFocused()
  expect(await page.getByRole('textbox', { name: 'Description', exact: true }).evaluate(
    element => getComputedStyle(element).outlineStyle,
  )).toBe('solid')
  await page.getByRole('link', { name: 'Open public channel' }).click()
  await expect(page).toHaveURL('/watch/live')
  await page.goto('/account/channel')
  const initialDescription = await page.getByRole('textbox', { name: 'Description', exact: true }).inputValue()
  await page.getByLabel('Title', { exact: true }).fill('Test channel title')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Test channel description')
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Channel details updated.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Test channel title')
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Test channel description')
  // Bypass the browser limit to exercise server-side validation.
  await page.getByLabel('Title', { exact: true }).evaluate((input: HTMLInputElement) => {
    input.maxLength = 121
    input.value = 'x'.repeat(121)
  })
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.locator('main [role=alert]')).toBeVisible()
  await expect(page.getByText('Channel details updated.')).toHaveCount(0)
  await page.getByLabel('Title', { exact: true }).fill('Live stream')
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(initialDescription)
  await page.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByText('Channel details updated.')).toBeVisible()

  const notifications = page.getByLabel('Send a notification when this channel goes live')
  await expect(notifications).toHaveRole('switch')
  await notifications.focus()
  const initialNotifications = await notifications.isChecked()
  await page.keyboard.press('Space')
  await expect(notifications).toBeChecked({ checked: !initialNotifications })
  await notifications.setChecked(!initialNotifications)
  await page.reload()
  await expect(notifications).toBeChecked({ checked: initialNotifications })
  await notifications.setChecked(!initialNotifications)
  await page.getByRole('button', { name: 'Save notification setting' }).click()
  await expect(page.getByText('Discord notifications updated.')).toBeVisible()
  await page.reload()
  await expect(notifications).toBeChecked({ checked: !initialNotifications })
  // Clear the previous notice so the next assertion waits for the new save.
  await page.goto('/account/channel')
  await notifications.setChecked(initialNotifications)
  await page.getByRole('button', { name: 'Save notification setting' }).click()
  await expect(page.getByText('Discord notifications updated.')).toBeVisible()

  await page.getByRole('button', { name: 'Copy server URL', exact: true }).click()
  await expect(page.locator('main [role=alert]')).toHaveText('Copy failed. Select the value and copy it manually.')
  await expect(page.getByRole('button', { name: 'Server URL copied', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'End broadcast', exact: true }).click()
  await expect(page.locator('main [role=alert]')).toHaveText('MediaMTX could not disconnect the broadcast.')
  await page.getByText('Installer details & security').click()
  await expect(page.getByText(/SHA-256/)).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download OBS setup for Windows' }).click()
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
  await page.reload()
  await expect(page.getByText(/^mtx_sk_[A-Za-z0-9_-]+$/)).toHaveCount(0)
  for (const path of ['/', '/watch/live', '/account', '/statistics']) {
    await page.goto(path)
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.locator('[data-site-header]').evaluate(
        element => element.getBoundingClientRect().height,
      )).toBe(50)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
  }
})
