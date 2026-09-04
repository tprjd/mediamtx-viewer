# Discord live notifications plan

Add a Discord webhook notifier that sends one embed when a channel goes live.
The message includes the channel title, owner, watch link, and a thumbnail
attachment. It must not spam the webhook when a publisher stops and starts
quickly.

## Existing building blocks

The stack already has the data the notifier needs:

- `lib/channel-status-monitor.ts` polls MediaMTX, deduplicates transitions,
  and shares one poller across subscribers.
- `INTERNAL_AUTH_SECRET` already authenticates private services to the viewer.
- `app/api/channels/[slug]/thumbnail` returns the current JPEG for a channel
  without application-level authentication.

The notifier should subscribe to the shared monitor instead of polling the
channel API directly.

## Architecture

Add a `discord-notifier` service to
`deploy/oracle/docker-compose.yml`. The service:

- Runs a Node script, `scripts/discord-notifier.mjs`.
- Subscribes to a new private SSE endpoint on the viewer.
- Keeps its deduplication state in a JSON file under a small named volume.
- Sends notifications to one Discord webhook URL.

The service needs no public port and no access to Caddy. It depends on the
viewer being healthy before it starts.

## Private event stream

Add `app/api/internal/channel-events/route.ts`. The route:

- Requires the `x-internal-auth` header to match `INTERNAL_AUTH_SECRET` with
  `timingSafeEqual`.
- Streams events from `getChannelStatusMonitor()` as SSE.
- Uses the same event shape as the authenticated browser SSE route.

The notifier opens this stream with the internal secret. One subscriber keeps
the shared monitor polling, so live transitions are delivered to the notifier
without a second MediaMTX poller.

## Per-channel opt-in

Add a `discord_notifications_enabled` boolean column to the `channel` table.
Default it to false so channels stay quiet until the owner opts in.

The channel owner toggles the setting on `/account/channel`. The monitor event
must include this flag so the notifier can skip opted-out channels.

## Live detection

For each monitor event:

1. Read `discordNotificationsEnabled`.
2. Read `status.live`.
3. Read `status.startedAt`.

Skip the event when notifications are disabled. A channel becomes a candidate
when `live` changes from false to true and `startedAt` is not null. The
notifier tracks the candidate start time and promotes it only after the stable
window passes.

## Spam rules

Apply three rules before sending:

- **Stable window**: a channel must stay live for 30 seconds before the first
  notification.
- **Started-at dedupe**: store `startedAt` with the notification. Do not notify
  twice for the same `startedAt`.
- **Per-channel cooldown**: after a live notification, suppress another live
  notification for that channel for 15 minutes.

The JSON state file keeps these rules intact across service restarts.

If `startedAt` changes before the cooldown expires, keep the old cooldown.
This prevents a stop-and-start loop from producing repeated messages.

## Cold start

The first snapshot is a baseline. Do not notify for channels that are already
live in the first snapshot. Only later false-to-true transitions may notify.

## Thumbnail

Discord cannot fetch `app/api/channels/[slug]/thumbnail` because that route is
behind Caddy auth. The notifier should:

1. Call the internal thumbnail route.
2. Attach the JPEG bytes to the webhook request as a multipart file.

If the thumbnail does not exist yet, send the message without an image. The
thumbnail worker creates the first JPEG 5 seconds after a stream appears.

## Configuration

Add `deploy/oracle/secrets/discord.env` with:

```text
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Reuse `PUBLIC_HOSTNAME` from `deploy/oracle/secrets/caddy.env` to build watch
links. The notifier also needs `INTERNAL_AUTH_SECRET` from `caddy.env`.
Update `deploy/oracle/deploy.sh` to require and copy the Discord secret with
the other deployment secrets. Keep the webhook URL out of Git.

In Compose, load both `caddy.env` and `discord.env` into the notifier service.

## Implementation steps

1. Add the `discord_notifications_enabled` migration and channel-page toggle.
2. Add the flag to the monitor update and the internal SSE route.
3. Write `scripts/discord-notifier.mjs`.
4. Add the service to `deploy/oracle/docker-compose.yml`.
5. Add the webhook secret to `deploy/oracle/secrets/discord.env`.
6. Update `deploy/oracle/deploy.sh` to validate and copy the secret.
7. Run the local unit checks and deploy.

## Verification

- Publish a stream and confirm one message arrives after 30 seconds.
- Stop and restart the same stream within a minute and confirm no second
  message arrives.
- Restart the notifier container and confirm the same `startedAt` does not
  produce another message.
- Start the notifier while a channel is already live and confirm it sends
  nothing for that existing broadcast.
