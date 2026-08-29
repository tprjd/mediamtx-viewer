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

if [ ! -f "$script_dir/secrets/caddy.env" ] || [ ! -f "$script_dir/secrets/mediamtx.yml" ]; then
  echo "Missing deploy/oracle/secrets/caddy.env or mediamtx.yml" >&2
  exit 1
fi

ssh "$deploy_target" "mkdir -p '$remote_dir/deploy/oracle/secrets'"

rsync -az \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
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

rsync -az "$script_dir/secrets/" "$deploy_target:$remote_dir/deploy/oracle/secrets/"

ssh "$deploy_target" "cd '$remote_dir' && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml config --quiet && docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml up -d --build && docker compose -f deploy/oracle/docker-compose.yml restart mediamtx && docker compose -f deploy/oracle/docker-compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile"

echo "Deployment complete. Inspect it with:"
echo "ssh $deploy_target \"cd '$remote_dir' && docker compose -f deploy/oracle/docker-compose.yml ps\""
