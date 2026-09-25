#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
action=${1:-}
case "$action" in
  enable|disable|health)
    shift
    if [ "$#" -eq 0 ]; then set -- local; fi
    exec node "$script_dir/../../scripts/deploy-release.mjs" "chat-$action" "$@"
    ;;
  *)
    echo 'Usage: chat-rollout.sh enable|disable|health [TARGET] [--project NAME]' >&2
    exit 2
    ;;
esac
