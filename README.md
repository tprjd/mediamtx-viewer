# MediaMTX Viewer

A viewer-first web frontend for the local MediaMTX streaming stack. It provides
a clean private channel directory and watch page while Feedboard remains a
separate private administration interface.

## Implemented

- Next.js App Router, React, and strict TypeScript
- Responsive Tailwind interface with shadcn-style Radix primitives
- Database-backed account-owned channels with validated stable URLs
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
- Admin-granted streaming access with hashed, revocable per-channel OBS keys
- Multiple simultaneous MediaMTX publishers on isolated channel paths
- Low-frequency live thumbnails with a five-second initial capture and
  three-minute refresh interval

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
THUMBNAIL_DIR=.data/thumbnails
```

Copy `.env.example` to `.env.local` only when those origins differ.
Registration starts closed. Sign in as the bootstrap administrator, open it on
`/admin/users`, and activate each new account after registration.

## Accounts and channels

Activating an account grants viewing access only. To let a friend broadcast,
open `/admin/users`, enter an immutable channel slug on their active account,
and select **Grant streaming**. Each account can own one channel.

The streamer signs in and opens `/account/channel`. That page provides the
channel-specific OBS server URL and generates a random stream key. The key is
shown once and stored only as a SHA-256 hash. Rotating it invalidates the old
key and disconnects the current publisher.

Configure OBS with:

- Service: `WHIP`
- Server: copy the URL from `/account/channel`
- Bearer token: copy the one-time stream key

Website passwords and browser sessions are never publishing credentials. A key
can publish only to its assigned MediaMTX path. Different owned channels can be
live simultaneously; a second publisher on the same channel is rejected.

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
the host MediaMTX listeners through `host.docker.internal`. Its thumbnail worker
uses the host MediaMTX HLS listener on port 8888, captures one 640×360 JPEG five
seconds after a channel becomes live, and refreshes it every three minutes.

For public deployment, the reproducible Oracle Cloud stack is documented in
[`deploy/oracle/README.md`](./deploy/oracle/README.md). Its OpenTofu module
creates the VM, reserved IP, and restricted network, while Docker Compose runs
Caddy, MediaMTX, and the viewer together. For another hosting provider, use
[`deploy/Caddyfile.example`](./deploy/Caddyfile.example) as a starting point.

Caddy validates the Better Auth session before sending `/media/hls/*` and
`/media/whep/*` directly to MediaMTX. MediaMTX validates each OBS bearer token
through the private Next.js callback before accepting its exact channel path.
Keep Feedboard on a separate private hostname or make it LAN/VPN-only.

## Live thumbnails

The thumbnail worker is separate from both Next.js and MediaMTX. It polls the
private Control API for live application-owned paths and decodes a single frame
through MediaMTX's private HLS listener. This path handles late-joining AV1
streams more reliably than RTSP. JPEGs are written atomically to a persistent
shared volume; the last successful image remains when a stream ends but is shown
only while that channel is live. The channel API includes a versioned thumbnail
URL only after a file exists, so cards retain their generated CSS artwork until
the first capture and whenever the channel is offline.

Thumbnail requests use the same Caddy account boundary as the rest of the site.
Landing-page browsers download only the JPEG and do not open WebRTC or HLS
sessions. Thumbnails are derived data and do not need to be included in account
database backups.

## Codec compatibility

MediaMTX passes codecs through; this application does not transcode them. AV1
playback depends on the browser, operating system, and hardware. H.264 video
with Opus audio is the recommended broadly compatible WHIP profile.

See [`PLAN.md`](./PLAN.md) for the architecture, security boundaries, future
phases, and acceptance criteria.

See [`AUTHENTICATION_PLAN.md`](./AUTHENTICATION_PLAN.md) for the implemented
individual-account, administrator-approval, and media-session authorization
architecture.

See [`MULTI_STREAMER_PLAN.md`](./MULTI_STREAMER_PLAN.md) for account-owned
channels, publishing authorization, rollout, and acceptance criteria.
