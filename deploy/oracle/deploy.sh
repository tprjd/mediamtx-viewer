#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <host-or-ssh-target>" >&2
  echo "Example: $0 ubuntu@158.180.29.172" >&2
  exit 2
fi

deploy_target=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)
remote_dir=/home/ubuntu/mediamtx-viewer

if [ ! -f "$script_dir/secrets/caddy.env" ] || \
  [ ! -f "$script_dir/secrets/mediamtx.yml" ] || \
  [ ! -f "$script_dir/secrets/oci-usage.env" ] || \
  [ ! -f "$script_dir/secrets/oci-usage-api-key.pem" ]; then
  echo "Missing an Oracle deployment secret (caddy.env, mediamtx.yml, oci-usage.env, or oci-usage-api-key.pem)" >&2
  echo "Apply deploy/oracle/terraform before deploying the statistics-enabled stack." >&2
  exit 1
fi

if ! grep -q '^MEDIAMTX_AUTH_SECRET=.' "$script_dir/secrets/caddy.env"; then
  echo "MEDIAMTX_AUTH_SECRET is missing from deploy/oracle/secrets/caddy.env" >&2
  echo "Run: node scripts/ensure-env-secret.mjs deploy/oracle/secrets/caddy.env MEDIAMTX_AUTH_SECRET" >&2
  exit 1
fi

node "$project_dir/scripts/validate-streaming-contract.mjs" \
  "$script_dir/secrets/mediamtx.yml"

ssh "$deploy_target" "mkdir -p '$remote_dir/deploy/oracle/secrets'"

rsync -az --inplace \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude .data \
  --exclude coverage \
  --exclude playwright-report \
  --exclude test-results \
  --exclude deploy/oracle/secrets \
  --exclude deploy/oracle/terraform/.terraform \
  --exclude deploy/oracle/terraform/terraform.tfstate \
  --exclude deploy/oracle/terraform/terraform.tfstate.backup \
  --exclude deploy/oracle/terraform/terraform.tfvars \
  --exclude 'deploy/oracle/terraform/tfplan*' \
  "$project_dir/" "$deploy_target:$remote_dir/"

rsync -az --inplace \
  --exclude mediamtx.yml \
  "$script_dir/secrets/" "$deploy_target:$remote_dir/deploy/oracle/secrets/"

rsync -az --inplace \
  "$script_dir/secrets/mediamtx.yml" \
  "$deploy_target:$remote_dir/deploy/oracle/secrets/mediamtx.yml.next"

ssh "$deploy_target" "cd '$remote_dir' && sh deploy/oracle/validate-mediamtx.sh deploy/oracle/secrets/mediamtx.yml.next --syntax-only"
mediamtx_config_changed=$(
  ssh "$deploy_target" "cd '$remote_dir' && sh -s" <<'REMOTE_SCRIPT'
current_config=deploy/oracle/secrets/mediamtx.yml
next_config=deploy/oracle/secrets/mediamtx.yml.next

if [ -f "$current_config" ] && cmp -s "$next_config" "$current_config"; then
  rm "$next_config"
  echo false
  exit
fi

if [ -f "$current_config" ]; then
  cp "$next_config" "$current_config"
  rm "$next_config"
else
  mv "$next_config" "$current_config"
fi
chmod 600 "$current_config"
echo true
REMOTE_SCRIPT
)

ssh "$deploy_target" "sudo ufw allow 443/udp && sudo ufw allow 8189/tcp"
ssh "$deploy_target" "cd '$remote_dir' && sudo install -m 644 deploy/oracle/90-mediamtx.conf /etc/sysctl.d/90-mediamtx.conf && sudo sysctl --system >/dev/null"

ssh "$deploy_target" "cd '$remote_dir' && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml config --quiet && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml up -d --build --wait"

if [ "$mediamtx_config_changed" = true ]; then
  echo "MediaMTX configuration changed; restarting MediaMTX"
  ssh "$deploy_target" "cd '$remote_dir' && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml restart mediamtx && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml up -d --wait"
fi

ssh "$deploy_target" "cd '$remote_dir' && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile"

ssh "$deploy_target" "cd '$remote_dir' && sh deploy/oracle/bootstrap-admin.sh"

echo "Deployment complete. Inspect it with:"
echo "ssh $deploy_target \"cd '$remote_dir' && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml ps\""
