import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const viewerUrl = process.env.VIEWER_URL ?? 'http://viewer:3000'
const internalSecret = process.env.INTERNAL_AUTH_SECRET
const publicHostname = process.env.PUBLIC_HOSTNAME
const webhookUrl = process.env.DISCORD_WEBHOOK_URL
const stateFile = process.env.STATE_FILE ?? '/state/discord-notifier-state.json'
const stableMs = Number(process.env.STABLE_MS ?? 30_000)
const cooldownMs = Number(process.env.COOLDOWN_MS ?? 900_000)

if (!internalSecret || !publicHostname || !webhookUrl) {
  throw new Error('Missing a required notifier environment variable')
}

const lastLive = new Map()
const pending = new Map()
let lastNotified = {}

async function loadState() {
  try {
    lastNotified = JSON.parse(await readFile(stateFile, 'utf8'))
  } catch {
    lastNotified = {}
  }
}

async function saveState() {
  await mkdir(dirname(stateFile), { recursive: true })
  const tempFile = `${stateFile}.tmp`
  await writeFile(tempFile, JSON.stringify(lastNotified), { mode: 0o600 })
  await rename(tempFile, stateFile)
}

function cooldownActive(slug) {
  const entry = lastNotified[slug]
  return entry && Date.now() - entry.atMs < cooldownMs
}

function cancelPending(slug) {
  const entry = pending.get(slug)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(slug)
}

function schedulePromotion(update) {
  cancelPending(update.slug)
  const timer = setTimeout(() => {
    pending.delete(update.slug)
    if (lastLive.get(update.slug) !== true) return
    if (cooldownActive(update.slug)) return
    if (lastNotified[update.slug]?.startedAt === update.status.startedAt) return
    void sendNotification(update)
  }, stableMs)
  pending.set(update.slug, { timer, update })
}

async function sendNotification(update) {
  const watchUrl = `https://${publicHostname}/watch/${encodeURIComponent(update.slug)}`
  const form = new FormData()
  form.append(
    'payload_json',
    JSON.stringify({
      embeds: [
        {
          title: `${update.title} is live`,
          description: `${update.ownerName} is streaming`,
          url: watchUrl,
          color: 0xdb2777,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  )

  try {
    const thumbnailResponse = await fetch(
      `${viewerUrl}/api/channels/${encodeURIComponent(update.slug)}/thumbnail`,
    )
    if (thumbnailResponse.ok) {
      const bytes = await thumbnailResponse.arrayBuffer()
      form.append(
        'files[0]',
        new Blob([bytes], { type: 'image/jpeg' }),
        'thumbnail.jpg',
      )
    }
  } catch {
    // Send without a thumbnail when the image is unavailable.
  }

  const response = await fetch(webhookUrl, { method: 'POST', body: form })
  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status}`)
  }

  lastNotified[update.slug] = {
    startedAt: update.status.startedAt,
    atMs: Date.now(),
  }
  await saveState()
}

function handleSnapshot(snapshot) {
  for (const update of snapshot.channels ?? []) {
    lastLive.set(update.slug, update.status.live)
    cancelPending(update.slug)
  }
}

function handleUpdate(update) {
  if (!update?.slug) return
  if (!update.discordNotificationsEnabled) {
    lastLive.set(update.slug, update.status.live)
    cancelPending(update.slug)
    return
  }

  const wasLive = lastLive.get(update.slug) === true
  const isLive = update.status.live === true
  lastLive.set(update.slug, isLive)

  if (isLive && !wasLive) {
    if (!update.status.startedAt) return
    if (cooldownActive(update.slug)) return
    if (lastNotified[update.slug]?.startedAt === update.status.startedAt) return
    schedulePromotion(update)
  } else if (!isLive && wasLive) {
    cancelPending(update.slug)
  }
}

function handleEvent(eventName, data) {
  if (eventName === 'snapshot') {
    handleSnapshot(data)
  } else if (eventName === 'channel-status') {
    handleUpdate(data)
  }
}

async function consumeStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const chunk = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      separator = buffer.indexOf('\n\n')
      handleChunk(chunk)
    }
  }
}

function handleChunk(chunk) {
  let eventName = 'message'
  const dataLines = []

  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) {
      eventName = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    }
  }

  if (dataLines.length === 0) return
  try {
    handleEvent(eventName, JSON.parse(dataLines.join('\n')))
  } catch {
    // Ignore a malformed event and keep the connection alive.
  }
}

async function connect() {
  const response = await fetch(`${viewerUrl}/api/internal/channel-events`, {
    headers: { 'x-internal-auth': internalSecret },
  })
  if (!response.ok || !response.body) {
    throw new Error(`Viewer event stream returned ${response.status}`)
  }
  await consumeStream(response)
}

let reconnectDelay = 1_000

async function main() {
  await loadState()
  while (true) {
    try {
      await connect()
      reconnectDelay = 1_000
    } catch (error) {
      console.error(`Discord notifier stream failed: ${error.message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, reconnectDelay))
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
  }
}

void main()
