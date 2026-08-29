# Oracle application deployment

The OpenTofu module in `terraform/` creates the Oracle VM and network. This
directory runs the application on that VM with Caddy as the only public HTTP
entry point.

## One-time secret setup

Create `secrets/caddy.env` from `caddy.env.example` and
`secrets/mediamtx.yml` from `mediamtx.yml.example`. These files are ignored by
Git and by the Docker build context.

Generate two independent strong passwords:

- Viewer password: hash it with `caddy hash-password`; put only the hash in
  `caddy.env` and keep the plaintext in a password manager.
- Publisher password: put it in `mediamtx.yml`; OBS uses the bearer token
  `publisher:<password>`.

## Deploy

From the repository root:

```sh
./deploy/oracle/deploy.sh ubuntu@$(cd deploy/oracle/terraform && tofu output -raw public_ip)
```

The script copies the source and ignored runtime secrets, validates the Compose
model, builds the viewer on the ARM VM, restarts MediaMTX so configuration
changes take effect, and reloads Caddy. This briefly interrupts an active
stream. It does not delete unrelated remote files or change DNS.

## DNS and OBS

After the stack is healthy, point `frankerzspam.duckdns.org` to the reserved
Oracle IP from `tofu output public_ip`. Caddy will then obtain its TLS
certificate automatically.

Configure OBS Custom WHIP service with:

- Server: `https://frankerzspam.duckdns.org/publish/whep/live/whip`
- Bearer token: `publisher:<publisher-password>`

The viewer is `https://frankerzspam.duckdns.org/` and uses the shared Caddy
Basic Auth username `gigachad` plus the generated viewer password.

## Operations

```sh
ssh ubuntu@SERVER_IP 'cd /home/ubuntu/mediamtx-viewer && docker compose -f deploy/oracle/docker-compose.yml ps'
ssh ubuntu@SERVER_IP 'cd /home/ubuntu/mediamtx-viewer && docker compose -f deploy/oracle/docker-compose.yml logs --tail=100'
```

Caddy certificate data survives container recreation in named volumes. Logs
rotate at 10 MiB with three files per container. To rotate credentials, update
the ignored secret files locally and run `deploy.sh` again.
