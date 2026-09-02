# MediaMTX Viewer

A self-hosted private streaming site for a small group of friends. OBS publishes
to MediaMTX, authenticated viewers watch through the Next.js interface, and
administrators approve accounts and grant individual streaming channels.

The production stack runs on an Oracle Cloud VM at
`https://frankerzspam.duckdns.org/`. Balanced LL-HLS is the default. Viewers can
select experimental HLS ≤2s, recovery-oriented Smooth HLS, or WebRTC; failed
low-margin modes return to a buffered HLS profile.

## Features

- Responsive Next.js App Router interface with strict TypeScript
- Better Auth username accounts, SQLite sessions, and administrator approval
- Self-service profile names shown as channel ownership labels
- Private channel directory with real-time live/offline status and viewer counts
- One administrator-granted channel and revocable OBS key per streamer
- Downloadable Windows setup that installs or updates OBS and creates managed
  60 fps AV1, HEVC, and H.264 profiles at 1440p and 1080p plus game scenes
- Multiple simultaneous publishers on isolated MediaMTX paths
- Four playback modes with bounded HLS latency, forward-buffer diagnostics, and
  automatic recovery fallback
- Shared Vidstack video controls and playback diagnostics
- Loading, reconnecting, offline, codec, and authorization states
- Authenticated server-sent status events with automatic degraded-mode recovery
- Low-frequency 640×360 thumbnails captured at stream start and every three
  minutes
- Unit, integration, component, route, worker, and Playwright coverage
- Signed-in OCI cost, Free Tier guardrail, allocation, and VM-health dashboard
- Reproducible Docker Compose and OpenTofu deployment

## Architecture

```text
OBS ── WHIP + channel stream key ──> Caddy ──> MediaMTX

Browser ── session cookie ──> Caddy
                               ├── pages, APIs, SSE ─> Next.js ──> SQLite
                               └── HLS and WHEP ───> MediaMTX

Next.js status monitor ── private Control API ──> MediaMTX
                       └── status/count events ──> Browser

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

Users can change the profile name shown below their stream from `/account`.
This does not change their sign-in username or immutable channel URL.

The streamer signs in and opens `/account/channel`. Windows users can download
the generic `Setup-FrankerzSpam-OBS.cmd` launcher there and double-click it. It
verifies its embedded PowerShell payload, uses a temporary process-only
execution policy, and then installs or updates
OBS Studio through WinGet, checks the hardware encoders OBS actually reports,
and creates one managed profile per requested codec and resolution — by default
AV1, HEVC (H.265), and H.264 at 1440p and 1080p, all 60 fps CBR with Opus
audio — plus a shared scene collection, without modifying unrelated OBS
profiles. Named game scenes capture the active fullscreen game; each also has a
disabled Window Capture fallback that can be selected while the game is
running. Setup 1.3.0 uses one-second keyframes for LL-HLS, backs up and replaces
the earlier unreliable
executable-only `(null)` capture targets on rerun and preserves the existing
1440p60 AV1 profile created by earlier setup versions.

The script opens a ten-minute authorization page in the browser. Approving the
displayed code binds that computer to the signed-in user's enabled channel,
rotates the previous publishing key, and delivers the new credential directly
to the waiting script. The downloadable file never contains a user or channel
credential, and the key is not printed. Version 1 is unsigned; use the SHA-256
shown beside the download before accepting any Windows publisher warning.

The same page also provides the channel-specific OBS URL and generates a
one-time stream key for manual setup. Rotating the key invalidates the old one
and disconnects its current publisher.

Configure OBS with:

- Service: `WHIP`
- Server: copy the channel URL from `/account/channel`
- Bearer token: generate and copy the one-time stream key

Different owned channels can be live simultaneously. A second publisher on the
same channel is rejected instead of replacing the first one.

## Status, viewer counts, and thumbnails

The landing and watch pages receive live state, viewer counts, tracks, and
generated-poster changes through one authenticated Server-Sent Events feed.
While at least one page is subscribed, a shared monitor checks the private
MediaMTX Control API every two seconds and emits only meaningful changes. Five
open pages therefore still produce one status check rather than five. A
20-second heartbeat detects stale connections, native browser reconnection is
enabled, and the existing JSON directory becomes a 30-second fallback only
while SSE is unhealthy.

Viewer counts represent active player tabs rather than unique accounts. Each
watch page tags its HLS and WebRTC sessions with one random request-scoped ID,
so preset changes, reconnects, and transport fallback do not count the same
player more than once. Two separately opened tabs count twice. Counts are shown
only while live. The thumbnail worker marks its private HLS session and the
status monitor excludes that session from the public number. If MediaMTX cannot
safely classify HLS sessions, the count is hidden instead of reporting a
misleading value.

The thumbnail worker polls the private MediaMTX Control API and decodes one frame
through its private HLS listener. It captures approximately five seconds after a
stream starts and every three minutes afterward. HLS is used because it handles
late-joining AV1 feeds more reliably than RTSP.

Each media path owns one JPEG that is atomically replaced, so periodic captures
do not accumulate. The last image remains stored when a stream ends but is shown
only while the channel is live. A deleted or renamed channel can leave one
orphaned JPEG; automatic orphan cleanup is not currently implemented.

Thumbnail requests and the SSE feed pass through the same Caddy account
boundary. Landing-page browsers download only JPEGs and do not open WebRTC or
HLS playback sessions.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The PowerShell payload source is in
[`scripts/windows/setup-frankerzspam-obs.ps1`](./scripts/windows/setup-frankerzspam-obs.ps1),
and the deterministic CMD launcher is generated in
[`lib/obs-setup-script.ts`](./lib/obs-setup-script.ts). Its payload extraction,
checksums, capture-mode defaults, and server/device-authorization contract are
covered by the test suite. PowerShell parsing and final encoder and capture
validation require Windows PowerShell and a Windows computer with an
appropriate NVIDIA, AMD, or Intel hardware encoder. OBS 30 removed the old AMF
plugin, but OBS 31/32 retain the texture-based AMD hardware encoders. The encoder
identifiers and property names are verified against the obsproject/obs-studio
sources but still need fixture verification against fresh OBS logs on Windows.

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
restricted network. Caddy is the only public HTTP entry point; WebRTC ICE uses
UDP 8189 with TCP 8189 as a fallback, and HTTP/3 uses UDP 443 while HTTP/2
remains available on TCP 443. Next.js, SQLite, the MediaMTX Control API, HLS
origin, metrics, RTSP, and thumbnail storage remain private inside Docker.

Deployment, secret generation, OBS setup, routine operations, encrypted SQLite
backup and restore, and rollback instructions are maintained in
[`deploy/oracle/README.md`](./deploy/oracle/README.md). Infrastructure details
are in [`deploy/oracle/terraform/README.md`](./deploy/oracle/terraform/README.md).
For another hosting provider, start from
[`deploy/Caddyfile.example`](./deploy/Caddyfile.example).

After applying the Terraform statistics identities and policy, signed-in viewers can use
`/statistics` to compare tenancy-wide OCI costs and projected reference
allowances with the current VM allocation and Monitoring telemetry. The page
fails closed to `Unknown` when billing cannot be verified. Compute and Monitoring
use the same dedicated read-only API key as billing in production, with the VM
instance principal retained as a fallback for inventory and metrics. The OCI
user can only read usage reports, compute/volume inventory, and metrics. Its key
is mounted from the git-ignored deployment secrets directory and is never
included in the image.

The deployment script validates staged MediaMTX configuration, rebuilds the
stack, applies database migrations, and leaves an unchanged MediaMTX container
running. Valid configuration changes are hot-reloaded where supported:

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
depends on browser, operating-system, and hardware support, and HEVC support
is limited in some browsers. The downloadable Windows setup creates a profile
for every hardware encoder OBS reports — AV1, HEVC (H.265), and H.264 at 1440p
and 1080p by default — all with Opus audio. H.264 remains the broadly
compatible profile for older viewer devices.
