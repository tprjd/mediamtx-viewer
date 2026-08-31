# Real-time channel status and viewer count plan

## Status

Implemented on 2026-08-31. The optional MediaMTX-hook phase remains deferred.

## Goal

Show live/offline state and viewer counts promptly on both the homepage and the
channel page without making every open browser repeatedly request the same
MediaMTX state. Keep timer-based work where it is the simplest or protocol-
appropriate solution, and keep the deployment inside the existing single free
Oracle VM.

## Recommendation

Replace the two browser status polling loops with one authenticated Server-Sent
Events (SSE) feed. Back that feed with one shared server-side MediaMTX status
monitor that polls `/v3/paths/list` every 2 seconds and broadcasts only changes.

This intentionally does not try to remove every timer:

- Keep local playback-stat sampling, player watchdogs, HLS media requests, OBS
  device authorization polling, and the thumbnail worker's scheduling.
- Start with centralized reconciliation rather than MediaMTX hooks. At the
  expected friend-group scale, this is reliable, easy to operate, and removes
  duplicated browser requests without requiring a custom MediaMTX image.
- Treat MediaMTX event hooks as a later optimization. Even with hooks, retain a
  slow reconciliation poll so a missed event or process restart cannot leave
  stale state on screen.

MediaMTX provides `runOnOnline`, `runOnOffline`, `runOnRead`, and `runOnUnread`
hooks for propagating stream and reader events to external software. Next.js
Route Handlers can return a streaming `ReadableStream`, which is sufficient for
an SSE endpoint. References:

- [MediaMTX hooks](https://mediamtx.org/docs/features/hooks)
- [MediaMTX configuration reference](https://mediamtx.org/docs/references/configuration-file)
- [Next.js Route Handler streaming](https://nextjs.org/docs/app/api-reference/file-conventions/route#streaming)

## Current timer inventory

| Area | Current behavior | Decision |
| --- | --- | --- |
| Homepage channel state | `components/home-dashboard.tsx` requests `/api/channels` every 5 seconds while visible | Replace with SSE |
| Channel-page state | `hooks/use-channel-status.ts` requests the channel status every 3 seconds while offline and every 5 seconds while live | Replace with SSE |
| Thumbnail discovery | `scripts/thumbnail-worker.mjs` checks MediaMTX every 5 seconds, captures after 5 seconds, refreshes every 3 minutes, and retries after 20 seconds | Keep |
| OBS device authorization | The setup script polls every 3 seconds for a maximum of 10 minutes | Keep |
| Playback statistics | The browser samples its own player/WebRTC statistics every second | Keep; this is local sampling, not HTTP polling |
| WebRTC/HLS fallback handling | Short timeout-based playback watchdogs | Keep |
| HLS playback | The player obtains playlists and segments as required by HLS | Keep; this is part of the media protocol |
| Copy-button feedback | A 1.8-second UI reset timer | Keep |

The homepage and channel-page loops are the useful targets because many users
ask the server for identical shared state. The remaining timers either run
locally, are short-lived, or manage periodic work that still needs scheduling.

## Target architecture

```text
MediaMTX Control API (/v3/paths/list)
                  |
                  | one request every 2 seconds while subscribers exist
                  v
      shared status monitor in the Next.js process
          | normalize, cache, compare, reconcile
          |
          +---- authenticated SSE /api/channel-events
                         |
                  snapshot + changed channels
                         |
                 homepage and watch pages
```

This design assumes the current production topology: one self-hosted Next.js
process on one Oracle VM. It deliberately avoids Redis, NATS, or another paid or
stateful broker. If the application later runs multiple Next.js replicas, the
in-process broadcaster must be replaced by a shared broker or a dedicated
status service.

### Shared status monitor

Add a server-only monitor responsible for all live state exposed to browsers:

1. Start lazily when the first SSE subscriber connects.
2. Query MediaMTX `/v3/paths/list` once every 2 seconds.
3. Normalize results for the registered channels.
4. Cache the latest status for each channel.
5. Compare stable fields and publish only meaningful changes. Do not treat
   `checkedAt` alone as a state change.
6. Stop the fast interval when the last subscriber disconnects.
7. Back off to a maximum of 30 seconds after repeated MediaMTX failures.
8. Publish `unavailable` only after two consecutive failures, retaining the last
   known live/offline state until then to avoid visible flicker.
9. Recover automatically and publish a fresh snapshot when MediaMTX returns.

The monitor should use `globalThis` for its one production-process instance so
separate route imports and development hot reloads do not create accidental
duplicate intervals. Its lifecycle and cleanup must be tested explicitly.

### Viewer count

Extend the MediaMTX path schema to read its `readers` collection and expose:

```ts
viewerCount: number | null
```

- Use a number when MediaMTX state is available.
- Use `0` for a known offline channel.
- Use `null` when MediaMTX cannot be reached; the UI should display an em dash or
  hide the count rather than incorrectly claiming zero viewers.
- Count reader sessions, not logged-in accounts. Two tabs or two devices count
  as two viewers.
- Exclude internal thumbnail-capture sessions. Mark the thumbnail worker's
  MediaMTX request with an internal query value and filter matching readers, or
  use reader/session metadata if that is more reliable in the deployed
  MediaMTX version.
- Keep a count visible only for live channels. Offline cards do not need a
  `0 viewers` label.

Before implementing the filter, verify the exact reader fields returned by the
deployed MediaMTX 1.20.1 Control API for WebRTC, HLS, and the thumbnail worker.
Add captured, anonymized response shapes as test fixtures rather than relying on
an undocumented assumption.

### SSE endpoint

Add `GET /api/channel-events` as a Node.js Route Handler returning
`text/event-stream`.

Behavior:

- Require the same authenticated session as the homepage and channel pages.
- Rely on same-origin session cookies; do not put credentials or tokens in the
  event-stream URL.
- Send an initial `snapshot` event immediately after connection.
- Send a `channel-status` event only when state, start time, tracks, viewer
  count, or the generated live-poster URL changes.
- Send a named `heartbeat` event every 20 seconds so idle connections remain
  healthy through Caddy and intermediaries and the browser can detect it.
- Assign monotonically increasing event IDs within the process.
- Close and unregister the subscriber when `request.signal` is aborted.
- Set `Cache-Control: no-cache, no-transform` and disable proxy buffering where
  needed.
- Do not expose MediaMTX path names, reader IDs, stream keys, or internal query
  values to browsers.

Proposed event shapes:

```text
event: snapshot
data: {"channels":[{"slug":"...","status":{...},"poster":null}]}

event: channel-status
data: {"slug":"...","status":{...},"poster":null}

event: heartbeat
data: {"at":"..."}
```

The feed is deliberately limited to `slug`, status, and the final live-poster
URL. The poster is needed so an open homepage sees newly generated thumbnails.
Titles, owners, descriptions, playback URLs, MediaMTX paths, and other channel
metadata remain outside the stream; navigation or refresh picks up those less
frequent changes.

### Browser behavior

Create one reusable hook for the homepage and watch page:

1. Seed state with the server-rendered initial data, preserving fast first
   paint and avoiding a loading flash.
2. Open one `EventSource('/api/channel-events')` connection per page.
3. Merge snapshots and per-channel deltas into existing state.
4. Preserve the current accessible announcement when a channel becomes live.
5. Mark updates delayed if no event or heartbeat has arrived for 45 seconds.
6. Let `EventSource` reconnect automatically.
7. After repeated connection failures, use the existing JSON endpoint as a
   slow 30-second fallback. Do not run fallback polling while SSE is healthy.
8. On tab visibility recovery, reconnect if the event stream is not open; do
   not unconditionally issue another status request.

Keep `/api/channels` and `/api/channels/[slug]/status` as initial-data,
diagnostic, and degraded-mode endpoints. Removing them provides little benefit
and makes rollback harder.

## Why not WebSockets

The browser only needs server-to-client state updates. SSE already supports
streaming responses, same-origin cookies, automatic reconnection, and ordinary
HTTP proxying. WebSockets would add a bidirectional protocol and connection
management without a current use case.

WebRTC remains the correct transport for the live media itself. The SSE channel
is only for small metadata updates and never carries video or audio.

## Why not make MediaMTX hooks phase one

Hooks can reduce the central 2-second MediaMTX reconciliation interval, but they
also add operational pieces:

- The hook command runs in the MediaMTX container and needs a dependable way to
  call an internal authenticated endpoint.
- Reader start/stop deltas must survive a missed callback, a Next.js restart,
  and a MediaMTX restart.
- HLS and WebRTC session lifecycles must be verified before treating hook
  counts as authoritative.
- The thumbnail reader still needs to be excluded.

At the current scale, one private Control API request every 2 seconds is
negligible and far simpler to repair. Hooks remain a valid second optimization:

1. Send `runOnOnline`, `runOnOffline`, `runOnRead`, and `runOnUnread` events to a
   private signed endpoint or a small internal relay.
2. Use hook arrival to request an immediate status refresh rather than directly
   incrementing or decrementing counters.
3. Reduce the normal reconciliation interval to 30-60 seconds.
4. Keep reconciliation permanently as protection against missed events.

This produces event-level responsiveness while preserving correctness.

## Thumbnail worker decision

Keep the current worker loop. It performs genuinely periodic work: a first
capture shortly after the stream starts, a new image every 3 minutes, and retry
after failure. Replacing its 5-second discovery poll with `runOnOnline` would
still leave the 3-minute timer and retry scheduler, while making the thumbnail
process more tightly coupled to MediaMTX hooks.

MediaMTX documents periodic snapshot extraction inside `runOnAvailable`, but the
existing separate worker has better failure isolation and already owns atomic
file replacement and cleanup:

- [MediaMTX snapshot extraction](https://mediamtx.org/docs/features/extract-snapshots)

The worker should remain the thumbnail owner unless status polling becomes a
measured resource problem.

## OBS device authorization decision

Keep its 3-second polling. It is temporary, bounded to the setup window, and the
website cannot initiate an inbound connection to an arbitrary Windows PC behind
NAT. A long-lived SSE request in PowerShell would make the installer more
fragile without a meaningful capacity saving.

## Implementation phases

### Phase 1: viewer-count contract and tests

- Extend the normalized channel status with `viewerCount`.
- Add MediaMTX API fixtures for offline, WebRTC, HLS, multiple readers, malformed
  data, and unavailable API responses.
- Prove and implement internal-thumbnail filtering.
- Render the count on live homepage cards and beside the live state on the
  channel page.
- Keep the current browser polling during this phase so viewer-count changes can
  be verified independently of the transport change.

### Phase 2: shared monitor

- Extract status normalization and stable comparison.
- Add the lazy singleton monitor with subscriber lifecycle, backoff, and
  unavailable-state handling.
- Test that multiple subscribers still create only one MediaMTX request per
  interval.
- Add structured logs only for state transitions and failure/recovery, not for
  every successful tick.

### Phase 3: authenticated SSE

- Implement the Route Handler and heartbeat behavior.
- Confirm Caddy passes events immediately and does not buffer the stream.
- Add cleanup tests for aborted connections.
- Verify that unauthenticated requests receive the expected auth response and
  never remain open.

### Phase 4: browser migration

- Replace the homepage loop.
- Replace `use-channel-status` on the channel page.
- Retain a slow polling fallback only while SSE is unhealthy.
- Verify live announcements, offline transitions, player teardown/restart, and
  count updates in multiple simultaneous browser sessions.

### Phase 5: deploy and observe

- Deploy without changing MediaMTX hooks.
- Confirm one shared Control API polling loop regardless of browser count.
- Confirm event connections are released when tabs close.
- Check CPU, memory, open file descriptors, response buffering, reconnects, and
  logs over at least one full stream start/stop session.
- If stable, update README and Oracle deployment documentation.

### Optional phase 6: MediaMTX-assisted wake-ups

- Add signed internal hook delivery.
- Trigger immediate monitor reconciliation from hook events.
- Slow the safety reconciliation interval to 30-60 seconds.
- Do this only if the 2-second central poll is measured as wasteful or sub-second
  event delivery becomes important.

## Tests and acceptance criteria

### Automated

- Normalization and viewer-count unit tests cover every supported reader shape.
- Thumbnail readers never increase the public count.
- Status equality ignores `checkedAt` but detects all meaningful changes.
- Five SSE subscribers result in one monitor interval, not five.
- An initial snapshot is sent immediately.
- Only changed channels produce delta events.
- Subscriber cleanup stops heartbeats and eventually stops the fast monitor.
- MediaMTX failure retains the last known state, then marks status delayed or
  unavailable according to the chosen threshold.
- SSE failure starts slow fallback polling; recovery stops it.
- Existing homepage, channel viewer, auth, and thumbnail tests remain green.

### Manual production check

- Start an OBS stream and see `Live` on both pages within about 3 seconds.
- Stop the stream and see `Offline` within about 3 seconds without flicker.
- Open several authenticated browsers and see the same viewer count within one
  update interval.
- Close one playback session and see the count decrease.
- Thumbnail capture does not change the count.
- Restart the viewer container and confirm open pages reconnect automatically.
- Restart MediaMTX and confirm status recovers without requiring a page reload.
- Leave a page open for at least 30 minutes and confirm the SSE connection does
  not accumulate memory or duplicate events.

## Rollback

Keep the current JSON endpoints and polling implementations until the SSE path
has passed production observation. A deployment flag can select SSE or legacy
polling. Rollback therefore consists of disabling the SSE client path; no data
migration or MediaMTX configuration rollback is required.

## Out of scope

- Moving video traffic through Next.js or SSE.
- Counting unique people across tabs or devices.
- Persistent viewer analytics or viewer-history reporting.
- A multi-node event broker.
- MediaMTX hook customization in the initial implementation.
- Changing thumbnail frequency or OBS authorization behavior.
