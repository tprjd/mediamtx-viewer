#!/bin/sh
set -eu

compose_file=deploy/oracle/docker-compose.yml
admin_env=deploy/oracle/secrets/admin.env
caddy_env=deploy/oracle/secrets/caddy.env

if docker compose --env-file "$caddy_env" -f "$compose_file" exec -T viewer node scripts/has-admin.mjs; then
  echo "An active administrator already exists; bootstrap skipped."
  exit 0
fi

if [ ! -f "$admin_env" ]; then
  echo "No active administrator exists and $admin_env is missing." >&2
  exit 1
fi

set -a
. "$admin_env"
set +a

ADMIN_NAME=${ADMIN_NAME:-$ADMIN_USERNAME}

docker compose --env-file "$caddy_env" -f "$compose_file" exec -T \
  -e ADMIN_USERNAME \
  -e ADMIN_EMAIL \
  -e ADMIN_NAME \
  -e ADMIN_PASSWORD \
  viewer node scripts/bootstrap-admin.mjs
