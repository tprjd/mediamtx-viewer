# Oracle application deployment

The OpenTofu module in `terraform/` creates the Oracle VM and network. This
directory runs the application on that VM with Caddy as the only public HTTP
entry point.

## One-time secret setup

Create `secrets/caddy.env` from `caddy.env.example`, `secrets/admin.env` from
`admin.env.example`, and `secrets/mediamtx.yml` from `mediamtx.yml.example`.
These files are ignored by Git and by the Docker build context.

Generate independent strong secrets:

- `BETTER_AUTH_SECRET`, `INTERNAL_AUTH_SECRET`, and `MEDIAMTX_AUTH_SECRET`:
  generate each with
  `openssl rand -hex 32` and put them in `caddy.env`.
- Initial administrator: set username, email, display name, and a password of
  at least 15 characters in `admin.env`. Bootstrap is skipped after an active
  administrator exists.
- `mediamtx.yml` contains no fallback publisher credential. Account-owned stream
  keys are generated from `/account/channel` and stored only as hashes in
  SQLite.

The old viewer username and bcrypt hash remain in `caddy.env` only so
`Caddyfile.basic-auth` can be restored during rollback. Account auth does not
use them.

## Deploy

From the repository root:

```sh
./deploy/oracle/deploy.sh ubuntu@$(cd deploy/oracle/terraform && tofu output -raw public_ip)
```

The script copies the source and ignored runtime secrets, validates the staged
MediaMTX configuration in an isolated container and the Compose model, builds
the viewer and FFmpeg thumbnail worker on the ARM VM, applies versioned SQLite
migrations, creates the first administrator when needed, updates the UDP 443
and TCP 8189 UFW rules, and reloads Caddy. Compose recreates MediaMTX only when
its image or service definition changes; valid config-only changes are
hot-reloaded where supported. It does not delete unrelated remote files, the
auth volume, or DNS.

The deploy also installs `90-mediamtx.conf`, setting the Linux UDP send and
receive ceilings to 7.5 MB for QUIC and WebRTC. This follows quic-go's current
Linux recommendation and prevents the HTTP/3 socket from starting with a
constrained receive buffer.

## DNS and OBS

After the stack is healthy, point `frankerzspam.duckdns.org` to the reserved
Oracle IP from `tofu output public_ip`. Caddy will then obtain its TLS
certificate automatically.

Each streamer can instead sign in, open `/account/channel`, and download the
Windows CMD launcher. Double-clicking it verifies and extracts its embedded
PowerShell payload without changing the permanent execution policy. It installs
or updates OBS with WinGet, creates the managed 1440p60 hardware-AV1 profile and
game scenes, then opens a ten-minute browser authorization. Approval rotates the
channel's previous publishing key and sends the new one only to the waiting
script. The launcher is generic and unsigned in version 1; its SHA-256 is shown
on the download page.

For manual setup, configure OBS Custom WHIP service with:

- Server: copy the channel-specific `/publish/whip/.../whip` URL from
  `/account/channel`.
- Bearer token: generate and copy the one-time stream key from that page.

### Stream quality and resilience

Smooth LL-HLS is the default viewer mode and runs a few seconds behind the live
edge. Viewers can explicitly select WebRTC low latency. A failed WebRTC repair
falls back to the already-warm HLS muxer, and the player waits 60 seconds before
offering another low-latency attempt. HLS retries transient failures with
bounded exponential backoff while the stream remains live; hidden tabs and
intentional pauses do not create reconnect storms.

MediaMTX metrics and its Control API remain private on the Compose network. The
health sidecar checks them and the RTSP, HLS, WHEP, and TCP ICE listeners without
restarting MediaMTX on a failed probe. Inspect the counters with:

```sh
docker compose --env-file deploy/oracle/secrets/caddy.env \
  -f deploy/oracle/docker-compose.yml exec -T mediamtx-health \
  wget -qO- http://mediamtx:9998/metrics
```

Confirm HTTP/3 in browser DevTools or with a QUIC-enabled client; blocking UDP
443 must still leave HLS working over HTTP/2. Blocking UDP 8189 should select
TCP ICE, visible in the browser playback diagnostics. Blocking both ICE ports
should lead to HLS without a page refresh.

### Stream quality troubleshooting

Publisher-side RTP loss can leave incomplete AV1 fragments. Use a stable wired
upload connection or lower the video bitrate when MediaMTX logs publisher loss;
viewer-side loss is reported in the playback diagnostics. MediaMTX passes the
stream through and cannot restore compression detail lost before or during
publishing. For fine detail, prefer 1440p60 at 12–16 Mbps over 4K60 at 10 Mbps.

The viewer is `https://frankerzspam.duckdns.org/`. Sign in with the bootstrap
administrator, open registration temporarily at `/admin/users`, and activate
each friend after they register. Viewing and streaming are separate grants;
use the same admin page to create one channel for each approved streamer.

Signed-in viewers can open `/statistics` for tenancy-wide current-month OCI
costs, reference Free Tier projections, the viewer VM allocation, and live
compute metrics. Production OCI SDK calls use a dedicated Terraform-managed
user that has API-key access only and read-only access to usage reports, the
viewer compartment's compute/volume inventory, and metrics. Inventory and
monitoring can fall back to the exact-instance VM principal if the service key
is omitted. Terraform writes the key and environment file to
`deploy/oracle/secrets/`; the deployment mounts the key read-only and never
builds it into an image. OCI cost reporting can lag, so the page shows source timestamps and
never reports `Safe` when billing data is unavailable. Its metric charts are
operational telemetry and are not treated as billable outbound-transfer totals.

The device start and poll endpoints are the only OBS setup routes excluded from
Caddy's browser-session check. They accept short-lived opaque setup secrets,
are rate-limited, and do not issue a publishing credential until an active
signed-in channel owner approves the browser code. The script download and
approval pages remain behind normal account authentication.

## Operations

```sh
ssh ubuntu@SERVER_IP 'cd /home/ubuntu/mediamtx-viewer && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml ps'
ssh ubuntu@SERVER_IP 'cd /home/ubuntu/mediamtx-viewer && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml logs --tail=100'
```

Caddy certificate data, the SQLite authentication database, and derived channel
thumbnails survive container recreation in named volumes. The worker takes its
first 640×360 JPEG five seconds after a stream appears and refreshes it every
three minutes. Retained JPEGs are shown only while their channel is live. Its HLS
and Control API connections remain private to the Docker network. Logs rotate at
10 MiB with three files per container.

Channel state and reader counts reach authenticated pages through
`/api/channel-events`. Caddy disables response buffering for that SSE route.
Next.js performs one private MediaMTX status check every two seconds while any
page is connected, and browsers fall back to the JSON directory every 30 seconds
only if the event stream remains unhealthy. The thumbnailer's marked HLS reader
is excluded from viewer counts.

Back up SQLite online and encrypt the result with a base64-encoded 32-byte key:

```sh
docker compose --env-file deploy/oracle/secrets/caddy.env \
  -f deploy/oracle/docker-compose.yml exec -T \
  -e AUTH_BACKUP_KEY='...' viewer node scripts/backup-auth.mjs
```

Set `AUTH_BACKUP_DIR` to persistent storage; the script retains the latest
seven files. Test restore with `scripts/restore-auth.mjs` while the viewer is
stopped. The restore command keeps replaced database files beside the restored
copy.

To roll back the access boundary, copy `Caddyfile.basic-auth` over
`Caddyfile` on the VM and reload Caddy. Do not delete `auth_data`; keep the
account database intact for another attempt. The SSE endpoint requires a Better
Auth session, so a basic-auth rollback uses the browser's degraded 30-second
JSON status fallback until the normal Caddyfile is restored.
