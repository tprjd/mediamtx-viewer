# MediaMTX Viewer

A viewer-first web frontend for the local MediaMTX streaming stack. It provides
a clean public channel directory and watch page while Feedboard remains a
separate private administration interface.

## Implemented

- Next.js App Router, React, and strict TypeScript
- Responsive Tailwind interface with shadcn-style Radix primitives
- Validated allowlist of public channels
- Server-only MediaMTX status lookup with sanitized public responses
- HLS playback through hls.js, with native HLS where supported
- Native accessible video controls
- Automatic live/offline polling and playback recovery
- Explicit loading, reconnecting, offline, codec, and playback-error states
- Share action, mobile layout, reduced-motion support, and useful 404 pages
- Unit/component tests, Playwright flows, and production Docker image
- Example Caddy routing that keeps media bytes out of Next.js
- Better Auth username accounts with administrator approval and SQLite sessions
- One authenticated boundary for pages, APIs, HLS, and WHEP through Caddy

WebRTC is the low-latency default, with HLS as an automatic compatibility
fallback. Custom video controls remain intentionally deferred.

## Local development

MediaMTX must be running with its API, HLS, and WebRTC listeners available on
the default local ports.

```sh
npm install
npm run auth:migrate
# One time only; use a strong password of at least 15 characters.
ADMIN_USERNAME=power ADMIN_EMAIL=david05202@gmail.com ADMIN_PASSWORD='...' npm run auth:bootstrap
npm run dev
```

Open <http://localhost:3000>. When it is connected to the included Feedboard
stack, the Caddy integration also serves it at <https://watch.localhost>. The
included `live` channel maps to the MediaMTX path named `live`.

Environment defaults:

```text
MEDIAMTX_API_URL=http://127.0.0.1:9997
MEDIAMTX_HLS_URL=http://127.0.0.1:8888
MEDIAMTX_WEBRTC_URL=http://127.0.0.1:8889
```

Copy `.env.example` to `.env.local` only when those origins differ.
Registration starts closed. Sign in as the bootstrap administrator, open it on
`/admin/users`, and activate each new account after registration.

## Configure channels

Edit [`config/channels.json`](./config/channels.json). Every entry is a public
allowlisted channel; arbitrary MediaMTX paths are not exposed.

```json
{
  "slug": "friend",
  "mediaPath": "friend",
  "displayName": "Friend's channel",
  "title": "Playing tonight",
  "description": "An occasional relayed stream.",
  "accentColor": "#22c55e",
  "preferredPlayback": "webrtc"
}
```

The public URL for this example is `/watch/friend`. A publisher key and public
read permission for the `friend` MediaMTX path must be configured separately.

`fallbackMediaPath` may identify a separate H.264 compatibility feed. The
frontend cannot transcode AV1 itself.

The active OBS profile publishes AV1 video and Opus audio to MediaMTX with WHIP
at `http://localhost:8889/live/whip`. WHIP avoids the RTMP/Opus compatibility
problem and enables the viewer's low-latency WebRTC path. OBS publishes a
single 1080p60 AV1 track because MediaMTX WHEP selects only one video track;
HLS remains available when WebRTC or AV1 is unsupported.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Install Playwright's browsers once before running the end-to-end suite:

```sh
npx playwright install chromium
npm run test:e2e
```

## Docker

Build and run the standalone viewer locally:

```sh
docker compose up -d --build
```

The development compose file binds the viewer to `127.0.0.1:3000`. It reaches
the host MediaMTX listeners through `host.docker.internal`.

For public deployment, the reproducible Oracle Cloud stack is documented in
[`deploy/oracle/README.md`](./deploy/oracle/README.md). Its OpenTofu module
creates the VM, reserved IP, and restricted network, while Docker Compose runs
Caddy, MediaMTX, and the viewer together. For another hosting provider, use
[`deploy/Caddyfile.example`](./deploy/Caddyfile.example) as a starting point.

Caddy validates the Better Auth session before sending `/media/hls/*` and
`/media/whep/*` directly to MediaMTX. OBS publishing continues to use its
separate MediaMTX bearer token. Keep Feedboard on a separate private hostname
or make it LAN/VPN-only.

## Codec compatibility

MediaMTX passes codecs through; this application does not transcode them. AV1
playback depends on the browser, operating system, and hardware. For broad
compatibility, publish an H.264 rendition on a separate MediaMTX path and set it
as `fallbackMediaPath`.

See [`PLAN.md`](./PLAN.md) for the architecture, security boundaries, future
phases, and acceptance criteria.

See [`AUTHENTICATION_PLAN.md`](./AUTHENTICATION_PLAN.md) for the implemented
individual-account, administrator-approval, and media-session authorization
architecture.
