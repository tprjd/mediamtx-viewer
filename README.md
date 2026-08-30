# MediaMTX Viewer

A self-hosted private streaming site for a small group of friends. OBS publishes
to MediaMTX, authenticated viewers watch through the Next.js interface, and
administrators approve accounts and grant individual streaming channels.

The production stack runs on an Oracle Cloud VM at
`https://frankerzspam.duckdns.org/`. WebRTC is the low-latency default, with HLS
as an automatic compatibility fallback.

## Features

- Responsive Next.js App Router interface with strict TypeScript
- Better Auth username accounts, SQLite sessions, and administrator approval
- Private channel directory and dynamic live/offline status
- One administrator-granted channel and revocable OBS key per streamer
- Multiple simultaneous publishers on isolated MediaMTX paths
- WebRTC playback with automatic HLS compatibility fallback
- Native accessible video controls and playback diagnostics
- Loading, reconnecting, offline, codec, and authorization states
- Five-second status polling while live and automatic playback recovery
- Low-frequency 640×360 thumbnails captured at stream start and every three
  minutes
- Unit, integration, component, route, worker, and Playwright coverage
- Reproducible Docker Compose and OpenTofu deployment

## Architecture

```text
OBS ── WHIP + channel stream key ──> Caddy ──> MediaMTX

Browser ── session cookie ──> Caddy
                               ├── pages and APIs ──> Next.js ──> SQLite
                               └── HLS and WHEP ───> MediaMTX

Thumbnail worker ── private API + HLS ──> MediaMTX
                 └── JPEG volume ───────> Next.js thumbnail route
```

Caddy asks Next.js to validate the Better Auth session before serving protected
pages, APIs, HLS, or WHEP. Media bytes travel directly between Caddy and
MediaMTX instead of passing through Next.js.

MediaMTX separately asks a private Next.js callback to authorize each OBS token
for its exact channel path. Website passwords, browser sessions, and publishing
credentials are never interchangeable. Stream keys are displayed once and
stored only as SHA-256 hashes.

## Local development

Use Node.js 24. MediaMTX must be running with its Control API, HLS, and WebRTC
listeners on the default local ports.

```sh
npm install
cp .env.example .env.local
npm run auth:migrate

# One time only; use a password between 15 and 128 characters.
ADMIN_USERNAME=power \
ADMIN_EMAIL=administrator@example.com \
ADMIN_PASSWORD='replace-with-a-strong-password' \
npm run auth:bootstrap

npm run dev
```

Open <http://localhost:3000>. The initial administrator owns the `live` channel,
which maps to the MediaMTX path named `live`.

The default local paths and origins are:

```text
MEDIAMTX_API_URL=http://127.0.0.1:9997
MEDIAMTX_HLS_URL=http://127.0.0.1:8888
MEDIAMTX_WEBRTC_URL=http://127.0.0.1:8889
THUMBNAIL_DIR=.data/thumbnails
AUTH_DB_PATH=.data/auth.sqlite
BETTER_AUTH_URL=http://localhost:3000
```

`.env.example` also contains three distinct development secrets. Generate fresh
values before any non-local deployment. Registration starts closed. Sign in as
the bootstrap administrator, enable it temporarily on `/admin/users`, and
activate each new account after registration.

## Accounts and streaming

Account activation grants viewing access only. To let someone broadcast, open
`/admin/users`, enter an immutable channel slug on their active account, and
select **Grant streaming**. Each account can own one channel.

The streamer signs in and opens `/account/channel`. That page provides the
channel-specific OBS URL and generates a one-time stream key. Rotating the key
invalidates the old one and disconnects its current publisher.

Configure OBS with:

- Service: `WHIP`
- Server: copy the channel URL from `/account/channel`
- Bearer token: generate and copy the one-time stream key

Different owned channels can be live simultaneously. A second publisher on the
same channel is rejected instead of replacing the first one.

## Status and thumbnails

The landing page polls the channel directory every five seconds. The watch page
checks every five seconds while live and every three seconds while offline. Its
badge, player, tracks, and generated poster all use the same status.

The thumbnail worker polls the private MediaMTX Control API and decodes one frame
through its private HLS listener. It captures approximately five seconds after a
stream starts and every three minutes afterward. HLS is used because it handles
late-joining AV1 feeds more reliably than RTSP.

Each media path owns one JPEG that is atomically replaced, so periodic captures
do not accumulate. The last image remains stored when a stream ends but is shown
only while the channel is live. A deleted or renamed channel can leave one
orphaned JPEG; automatic orphan cleanup is not currently implemented.

Thumbnail requests pass through the same Caddy account boundary. Landing-page
browsers download only JPEGs and do not open WebRTC or HLS playback sessions.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Install Playwright's browser once before running the end-to-end suite:

```sh
npx playwright install chromium
npm run test:e2e
```

The Vitest suite covers authentication, channel authorization, status mapping,
the dashboard, the watch view, and thumbnail generation. Playwright covers the
primary desktop and mobile account/viewing flows.

## Docker

The development Compose stack builds the viewer and thumbnail worker while
using MediaMTX from the existing host stack. It expects the external
`feedboard_feedboard-net` network.

```sh
docker network inspect feedboard_feedboard-net >/dev/null 2>&1 || \
  docker network create feedboard_feedboard-net
docker compose up -d --build
```

The viewer binds to `127.0.0.1:3000`. Both containers reach the host MediaMTX
listeners through `host.docker.internal`.

## Oracle deployment

The production Compose stack runs Caddy, MediaMTX, Next.js, and the thumbnail
worker on one Oracle VM. The OpenTofu module creates the VM, reserved IP, and
restricted network. Caddy is the only public HTTP entry point; WebRTC ICE also
uses UDP 8189. Next.js, SQLite, the MediaMTX Control API, HLS origin, RTSP, and
thumbnail storage remain private inside Docker.

Deployment, secret generation, OBS setup, routine operations, encrypted SQLite
backup and restore, and rollback instructions are maintained in
[`deploy/oracle/README.md`](./deploy/oracle/README.md). Infrastructure details
are in [`deploy/oracle/terraform/README.md`](./deploy/oracle/terraform/README.md).
For another hosting provider, start from
[`deploy/Caddyfile.example`](./deploy/Caddyfile.example).

The deployment script rebuilds the stack, applies database migrations, and
briefly interrupts active streams when it restarts MediaMTX:

```sh
./deploy/oracle/deploy.sh ubuntu@SERVER_IP
```

## Persistent data

The Oracle Compose stack stores Caddy state, SQLite, and thumbnails in named
volumes. SQLite is the data that must be backed up. Thumbnails are derived and
can be regenerated; account database backups intentionally exclude them.

Local runtime data, deployment secrets, Terraform state, build output, test
reports, and dependencies are ignored by Git.

## Codec compatibility

MediaMTX passes codecs through; the site does not transcode playback. AV1
depends on browser, operating-system, and hardware support. H.264 video with
Opus audio is the recommended broadly compatible WHIP profile.
