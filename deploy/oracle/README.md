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

The script copies the source and ignored runtime secrets, validates the Compose
model, builds the viewer and FFmpeg thumbnail worker on the ARM VM, applies
versioned SQLite migrations,
creates the first administrator when needed, restarts MediaMTX, and reloads
Caddy. This briefly interrupts an active stream. It does not delete unrelated
remote files, the auth volume, or DNS.

## DNS and OBS

After the stack is healthy, point `frankerzspam.duckdns.org` to the reserved
Oracle IP from `tofu output public_ip`. Caddy will then obtain its TLS
certificate automatically.

Configure OBS Custom WHIP service with:

- Server: copy the channel-specific `/publish/whip/.../whip` URL from
  `/account/channel`.
- Bearer token: generate and copy the one-time stream key from that page.

The viewer is `https://frankerzspam.duckdns.org/`. Sign in with the bootstrap
administrator, open registration temporarily at `/admin/users`, and activate
each friend after they register. Viewing and streaming are separate grants;
use the same admin page to create one channel for each approved streamer.

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
account database intact for another attempt.
