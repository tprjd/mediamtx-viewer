#!/bin/sh
# Installed outside release trees. Resolve the running release on every invocation.
set -eu
project=${1:-mediamtx-viewer}
case "$project" in ''|*[!a-z0-9_-]*) echo 'Invalid Compose project' >&2; exit 1;; esac
[ -z "$(docker ps -aq --filter "name=^/${project}-deploy-operation$")" ] || { echo 'Deployment or recovery holds the installation' >&2; exit 1; }
viewer=$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=viewer)
caddy=$(docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=caddy)
for container in "$viewer" "$caddy"; do
  case "$container" in ''|*[!a-f0-9]*) echo 'Active service identity is unavailable' >&2; exit 1;; esac
  [ "${#container}" = 64 ] || exit 1
done
AUTH_BACKUP_KEY=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$caddy" | sed -n 's/^AUTH_BACKUP_KEY=//p')
case "$AUTH_BACKUP_KEY" in ''|*[!A-Za-z0-9+/=]*) echo 'Backup key is unavailable' >&2; exit 1;; esac
export AUTH_BACKUP_KEY
exec docker exec -e AUTH_BACKUP_KEY "$viewer" node scripts/backup-auth.mjs
