import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Page } from '@playwright/test'
import type Hls from 'hls.js'
import { expect, test } from './fixtures/viewer-session'

declare global {
  interface Window {
    __hlsRecoveryProbe?: { instance: Hls; recoveries: number; detachments: number }
  }
}

async function prepareLivePlayback(page: Page, mode = 'balanced') {
  await page.addInitScript((mode) =>
    sessionStorage.setItem('mediamtx-viewer:playback-mode', mode),
  mode)
  const playlist = readFileSync(
    resolve('tests/e2e/fixtures/chat-playback/index.m3u8'), 'utf8',
  )
    .replace('#EXT-X-PLAYLIST-TYPE:VOD\n', '')
    .replace('#EXT-X-ENDLIST\n', '')
    .split('#EXTINF:')
  const media = readFileSync(resolve('tests/e2e/fixtures/chat-playback/media.mp4'))
  let startedAt = 0
  let extraSegments = 0

  await page.route('**/media/hls/live/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('.m3u8')) {
      startedAt ||= Date.now()
      const available = 10 + extraSegments + Math.floor((Date.now() - startedAt) / 2000)
      return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: playlist[0] + playlist.slice(1, available + 1)
          .map((segment) => `#EXTINF:${segment}`).join(''),
      })
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? '')
    const start = range ? Number(range[1]) : 0
    const end = range ? Number(range[2]) : media.length - 1
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      body: media.subarray(start, end + 1),
      headers: range ? { 'content-range': `bytes ${start}-${end}/${media.length}` } : {},
    })
  })

  await page.goto('/watch/live')
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    !element.paused && element.currentTime > 0,
  )).toBe(true)

  return { video, advanceLiveEdge: () => { extraSegments += 10 } }
}

test('recovers once from a fatal HLS media error and resumes Smooth playback', async ({ page }) => {
  // Observe the real provider through Vidstack's instance event. Keep both
  // Vidstack's error handler and hls.js media recovery active.
  await page.addInitScript(() => {
    document.addEventListener('hls-instance', (event) => {
      const instance = (event as CustomEvent<Hls>).detail
      const probe = { instance, recoveries: 0, detachments: 0 }
      window.__hlsRecoveryProbe = probe
      const recover = instance.recoverMediaError.bind(instance)
      instance.recoverMediaError = () => {
        probe.recoveries += 1
        recover()
      }
      const ctor = instance.constructor as typeof Hls
      instance.on(ctor.Events.MEDIA_DETACHING, () => { probe.detachments += 1 })
    }, true)
  })

  const { video } = await prepareLivePlayback(page, 'smooth')
  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 12 })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    !element.seeking && !element.paused && element.currentTime >= 12 && element.readyState >= 3,
  )).toBe(true)

  const recovery = await page.evaluate(() => {
    const probe = window.__hlsRecoveryProbe
    if (!probe) throw new Error('The real HLS provider did not create an instance')
    const ctor = probe.instance.constructor as typeof Hls
    probe.recoveries = 0
    probe.detachments = 0
    probe.instance.trigger(ctor.Events.ERROR, {
      fatal: true,
      type: ctor.ErrorTypes.MEDIA_ERROR,
      details: ctor.ErrorDetails.BUFFER_APPEND_ERROR,
      error: new Error('Injected media error for recovery regression'),
    })
    return { recoveries: probe.recoveries, detachments: probe.detachments }
  })
  expect(recovery).toEqual({ recoveries: 1, detachments: 1 })
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    !element.paused && element.readyState >= 3 && element.currentTime > 13,
  )).toBe(true)
  await expect(page.locator('.protocol-badge')).toHaveText('HLS · Smooth')
  await expect(page.locator('.player-overlay')).toHaveCount(0)
})

test('keeps the cursor visible over an offline stream after inactivity', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Mouse interaction requires desktop Chromium')
  await page.goto('/watch/alpha')
  await expect(page.getByText('Stream offline')).toBeVisible()
  const player = page.getByLabel('Alpha Channel live video')
  await player.hover({ position: { x: 150, y: 50 } })
  await expect(player).not.toHaveCSS('cursor', 'none')

  // Wait beyond the controls' two-second inactivity delay.
  await page.waitForTimeout(2_500)
  await expect(player).not.toHaveCSS('cursor', 'none')
  await expect(player.locator('.player-overlay')).not.toHaveCSS('cursor', 'none')
})

for (const mode of ['normal', 'theater', 'fullscreen'] as const) {
  test(`hides ${mode} controls and cursor after mouse activity stops`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Mouse interaction requires desktop Chromium')
    await prepareLivePlayback(page)
    const player = page.getByLabel('Live stream live video')
    const controls = player.locator('[data-player-controls]')
    await player.hover()
    if (mode === 'theater') {
      await player.getByRole('button', { name: 'Enter theater mode' }).click()
    } else if (mode === 'fullscreen') {
      await player.getByRole('button', { name: 'Enter fullscreen' }).click()
    } else {
      await player.getByRole('button', { name: 'Unmute video' }).click()
    }
    await player.hover({ position: { x: 150, y: 50 } })
    await expect(controls).not.toHaveAttribute('data-visible')
    await expect(controls).toHaveCSS('opacity', '0')
    await expect(player.locator('.protocol-badge')).toHaveCSS('opacity', '0')
    await expect(player).toHaveCSS('cursor', 'none')
    await expect(player.locator('video')).toHaveCSS('cursor', 'none')

    await player.hover({ position: { x: 160, y: 50 } })
    await expect(controls).toHaveCSS('opacity', '1')
    await expect(player).not.toHaveCSS('cursor', 'none')

    // Keyboard focus must still reveal controls after they hide.
    await expect(controls).toHaveCSS('opacity', '0')
    await page.keyboard.press('Tab')
    await expect(controls).toHaveCSS('opacity', '1')
  })
}

test('holds the paused frame as the HLS live edge advances and resumes playback', async ({ page }) => {
  const { video, advanceLiveEdge } = await prepareLivePlayback(page)
  const player = page.getByLabel('Live stream live video')
  await player.hover()
  await player.getByRole('button', { name: 'Pause video' }).click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  const pausedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime)
  advanceLiveEdge()

  // Observe several playlist refresh periods. A paused video must not seek.
  for (let sample = 0; sample < 6; sample += 1) {
    await page.waitForTimeout(500)
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(pausedAt)
  }
  await expect(player.locator('.player-overlay')).toHaveCount(0)

  await player.getByRole('button', { name: 'Play video' }).click()
  await expect.poll(() => video.evaluate((element: HTMLVideoElement, position) =>
    !element.paused && element.currentTime > position + 1,
  pausedAt)).toBe(true)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(30)
})
