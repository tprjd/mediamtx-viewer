# MediaMTX Viewer Plan

> Implementation status: the viewer defaults to WebRTC for the current
> WHIP/AV1/Opus source, with HLS as an automatic fallback. Public-domain
> deployment and an H.264 compatibility feed remain future integration work.

OBS publishes a single 1080p60 AV1 rendition. WHIP simulcast is intentionally
disabled because the current MediaMTX WHEP reader selects one video track and
does not expose adaptive switching between OBS simulcast layers.

## Goal

Build a polished public viewing site for occasional personal streams and
streams relayed for friends. A publisher sends one feed to MediaMTX; viewers
watch the redistributed feed through this site. The site has no chat and no
viewer accounts.

This project owns the viewer experience only. Feedboard remains private and is
used for users, publish keys, permissions, monitoring, and stream operations.

## Product principles

- The video is the main event; management controls never appear publicly.
- Opening a link should immediately communicate whether a stream is live.
- Playback should recover cleanly after brief publisher or network outages.
- The site should work well with a mouse, keyboard, touch, and screen reader.
- No publisher credential, MediaMTX API endpoint, or internal topology is sent
  to the browser.
- The first release should remain small enough to operate at home.

## Stack decision

### Application

- **Next.js App Router + React + TypeScript:** provides the public pages and a
  small server-side boundary for safe stream-status data.
- **Tailwind CSS + shadcn/ui + Radix UI:** provides accessible primitives and a
  coherent visual system without locking the project into a remote component
  package. Components are owned by this repository and can be restyled.
- **Lucide:** consistent lightweight icons.
- **Zod:** validates the channel configuration at startup and prevents an
  invalid MediaMTX path from becoming a broken public route.
- **React hooks + Fetch:** a small status hook polls the sanitized public API,
  pauses when the page is hidden, and uses bounded backoff after failures.

No Redux, client-side data-fetching library, or database is planned for version
one. React local state is enough for player and status state, and channel
definitions can begin as a versioned configuration file. A query library can be
introduced later if caching and synchronization requirements actually grow.

### Playback

- **WebRTC is preferred:** it provides sub-second playback when the browser,
  network path, and source codecs are compatible.
- **HLS is the automatic fallback:** it crosses home routers reliably, works
  well behind HTTPS, and accepts common H.264/AAC output.
- **hls.js** is used where Media Source Extensions are available; Safari uses
  native HLS.
- The WebRTC client loads the reader shipped by the running MediaMTX instance,
  keeping WHEP behavior aligned with the pinned server version.
- Opus is required for WebRTC audio. A source containing AAC audio automatically
  falls back to HLS instead of silently playing video without sound.
- Version one uses the browser's native video controls. Bespoke media controls
  are deferred until there is a concrete requirement that native controls
  cannot satisfy.
- AV1 is passed through rather than transcoded by the frontend. Playback still
  depends on browser and device codec support. A real compatibility fallback
  requires a separate H.264 rendition or path from the streaming stack; the
  browser cannot manufacture one.

### Operations

- **Caddy** terminates HTTPS and routes requests.
- **Next.js** serves HTML, assets, and small JSON status responses.
- **MediaMTX** serves HLS/WebRTC media directly through Caddy. Video bytes must
  not pass through a Next.js route handler.
- **Feedboard** stays on a private port or a separate admin hostname.
- The application will run in Docker alongside the existing stack.

## Architecture

```text
Publisher OBS ──WHIP/WebRTC──> MediaMTX
                               │
                               ├── HLS/WebRTC media ──> Caddy ──> Viewer
                               │
                               └── Control API ───────> Next server only

Viewer ── page/status ─────> Caddy ──> Next.js
Admin  ── private hostname ─> Caddy ──> Feedboard
```

Suggested public routes:

- `/` — primary channel or live-channel directory
- `/watch/[slug]` — dedicated viewer page for a configured channel
- `/api/channels` — sanitized public channel metadata and live state
- `/api/channels/[slug]/status` — one channel's live state
- `/media/hls/[path]/*` — Caddy proxy directly to MediaMTX HLS
- `/media/whep/[path]/*` — Caddy proxy directly to MediaMTX WebRTC/WHEP

The MediaMTX Control API remains bound internally and is never proxied to the
public browser.

## Channel model

Initial channel configuration:

```ts
type Channel = {
  slug: string
  mediaPath: string
  displayName: string
  title: string
  description?: string
  poster?: string
  accentColor?: string
  preferredPlayback: 'hls' | 'webrtc'
  fallbackMediaPath?: string
}
```

The public API returns only display fields, live state, and approved playback
URLs. Publish keys and internal addresses are never part of this model.

## Viewer experience

### Home page

- Show the primary live channel prominently.
- If several configured channels are live, show a responsive channel grid.
- Show a deliberate offline state when nobody is broadcasting.
- Never expose empty MediaMTX paths or administrative information.

### Watch page

- Large responsive 16:9 player with theater-mode layout.
- Stream title, broadcaster name, live badge, and copy-link action.
- Native browser play, mute, volume, fullscreen, and picture-in-picture
  controls where the browser supports them.
- Autoplay muted when allowed; make unmuting obvious.
- Poster and clear offline message before and after a broadcast.
- Automatic reconnect with restrained progress feedback.
- Automatic HLS compatibility fallback when WebRTC is unavailable.
- Friendly codec/browser error instead of a blank or endlessly spinning player.

### Visual direction

- Dark neutral background so game footage remains dominant.
- One configurable accent color per channel.
- Minimal chrome and no dashboard-like tables, sidebars, or statistics.
- Responsive from small phones through ultrawide desktop displays.
- Respect reduced-motion and high-contrast preferences.

## Security and privacy

- Public pages need no login; publish endpoints still require a stream key.
- Configure an explicit allowlist of public channel paths.
- Query MediaMTX status from the Next.js server over the private Docker network.
- Return a minimal public status shape rather than forwarding API responses.
- Rate-limit status endpoints at Caddy or the application boundary.
- Use HTTPS for all public playback and application traffic.
- Put Feedboard on a distinct admin hostname or make it LAN/VPN-only.
- Do not log stream keys, authentication headers, or full viewer IP addresses.

## Delivery phases

### 1. Scaffold and design foundation

- Create the Next.js TypeScript application.
- Add Tailwind, shadcn/ui, Radix-based components, and Lucide.
- Limit Radix/shadcn usage to surrounding interface elements such as buttons,
  badges, dialogs, and tooltips; do not rebuild the video control surface.
- Establish fonts, colors, spacing, responsive breakpoints, and dark theme.
- Add linting, formatting, Vitest, and Playwright.
- Add validated sample channel configuration.

### 2. Playback vertical slice

- Implement the HLS player lifecycle and native-HLS fallback.
- Build loading, live, offline, reconnecting, and unsupported-codec states.
- Use native video controls and test their surrounding labels, focus order, and
  keyboard-accessible actions.
- Create `/watch/[slug]` with one locally configured channel.

### 3. Safe stream discovery

- Add a server-only MediaMTX API client.
- Expose sanitized channel/status route handlers.
- Implement a small Fetch-based polling hook with page-visibility suspension,
  request cancellation, and bounded retry backoff.
- Build the home page's primary channel and multi-channel states.

### 4. Deployment integration

- Add a production multi-stage Docker image.
- Put Next.js, Feedboard, and MediaMTX on an internal Docker network where
  practical.
- Make Caddy the only public HTTP entry point.
- Route media directly from Caddy to MediaMTX.
- Move Feedboard to an admin hostname or LAN-only endpoint.
- Document domain, TLS, router forwarding, and CGNAT requirements.

### 5. Low latency and compatibility — implemented

- Prefer WebRTC playback and fall back to HLS after connection or codec failure.
- Detect missing WebRTC-compatible audio before remaining in low-latency mode.
- Define the AV1 support message and H.264 fallback-path behavior.
- Test Chrome, Firefox, Edge, Safari, Android, and iOS behavior where available.

### 6. Polish

- Add per-channel posters, colors, and share metadata.
- Add graceful stream start/end transitions.
- Audit accessibility, performance, and mobile layout.
- Add operational documentation and backup/upgrade instructions.
- Reconsider custom player controls or a query library only if user testing
  reveals a specific need.

## Test strategy

- Unit-test channel validation, public response sanitization, status mapping,
  retry policy, and player state transitions.
- Component-test offline, loading, live, reconnecting, and codec-error screens.
- End-to-end test direct watch URLs, unknown channels, mobile layout, keyboard
  controls, offline-to-live recovery, and live-to-offline recovery.
- Use deterministic mocked manifests for CI; keep a separate manual smoke test
  against the local MediaMTX instance.
- Verify media requests go directly to the Caddy media route and never through
  the Next.js status API.

## Version-one acceptance criteria

- A viewer can open a stable channel URL without signing in.
- A live H.264/AAC feed plays on current desktop and mobile browsers targeted by
  the project.
- Offline channels show a useful page and begin playback after the feed starts
  without requiring a full reload.
- A dropped feed moves to reconnecting and then offline without leaving a frozen
  player.
- Unknown channel slugs return a proper not-found page.
- No Control API response, admin credential, or publish key is browser-visible.
- The public site and private Feedboard UI can run beside the current MediaMTX
  deployment without port conflicts.
- Automated tests and a production build pass.

## Decisions needed before public deployment

- Public viewer and admin hostnames.
- Project name, logo, accent palette, and default offline poster.
- Initial public channel slugs and display names.
- Whether external viewers require TURN in addition to the static WebRTC port.
- Whether AV1-only streams are acceptable or every stream needs an H.264
  compatibility path.

None of these decisions blocks scaffolding or the first local HLS player.
