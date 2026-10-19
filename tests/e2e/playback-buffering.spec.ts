import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from './fixtures/viewer-session'

test('shows a small buffering label with controls hidden and keeps the same player', async ({ page, isMobile }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem('mediamtx-viewer:playback-mode', 'balanced'))
  const playlist = readFileSync(resolve('tests/e2e/fixtures/chat-playback/index.m3u8'), 'utf8')
    .replace('#EXT-X-PLAYLIST-TYPE:VOD\n', '')
    .replace('#EXT-X-ENDLIST\n', '')
    .split('#EXTINF:')
  const media = readFileSync(resolve('tests/e2e/fixtures/chat-playback/media.mp4'))
  let startedAt = 0
  let holdMedia = false
  let releaseMedia!: () => void
  const pendingMedia = new Promise<void>(resolve => { releaseMedia = resolve })
  await page.route('**/media/hls/live/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('.m3u8')) {
      startedAt ||= Date.now()
      const available = 10 + Math.floor((Date.now() - startedAt) / 2_000)
      await route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body: playlist[0] + playlist.slice(1, available + 1).map(segment => `#EXTINF:${segment}`).join(''),
      })
      return
    }
    if (holdMedia) await pendingMedia
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

  try {
    await page.goto('/watch/live')
    const video = page.locator('video')
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    const source = await video.evaluate((v: HTMLVideoElement) => v.currentSrc)
    const controls = page.locator('[data-player-controls]')
    const player = page.getByLabel('Live stream live video')
    if (isMobile) await player.tap({ position: { x: 150, y: 50 } })
    else await player.hover({ position: { x: 150, y: 50 } })
    await expect(controls).not.toHaveAttribute('data-visible')
    await expect(controls).toHaveCSS('opacity', '0')
    holdMedia = true
    const buffering = page.getByRole('status').filter({ hasText: 'Buffering' })
    await expect(buffering).toBeVisible({ timeout: 15_000 })
    await expect(controls).not.toHaveAttribute('data-visible')
    await expect(buffering).toHaveCSS('opacity', '1')
    await expect(buffering).toHaveCSS('pointer-events', 'none')
    const box = await buffering.boundingBox()
    expect(box!.width).toBeLessThan(100)
    expect(box!.height).toBeLessThan(30)
    await page.locator('.player-shell').screenshot({ path: testInfo.outputPath('buffering-hidden-controls.png') })
    await expect(page.locator('.player-overlay')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Reconnecting', exact: true })).toHaveCount(0)
    if (isMobile) await expect(page.getByRole('button', { name: 'Playback mode: Balanced', exact: true })).toBeVisible()
    else await expect(page.getByRole('radio', { name: 'Balanced', exact: true })).toBeChecked()
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe(source)
    const stalledAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    releaseMedia()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(stalledAt + 0.5)
    await expect(buffering).toHaveCount(0)
    expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toBe(source)
  } finally {
    releaseMedia()
  }
})
