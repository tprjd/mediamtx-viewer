#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1:-}" in
  adopt|managed|recover|cleanup|chat-enable|chat-disable|chat-health)
    exec node "$script_dir/../../scripts/deploy-release.mjs" "$@"
    ;;
  prepare|status)
    exec node "$script_dir/../../scripts/stage-release.mjs" "$@"
    ;;
esac
if [ "$#" -ge 2 ]; then
  case "$2" in v[0-9]*.[0-9]*.[0-9]*) exec node "$script_dir/../../scripts/deploy-release.mjs" managed "$@";; esac
fi
echo 'Usage: deploy.sh TARGET vX.Y.Z [options] | adopt TARGET | status TARGET | recover TARGET [options]' >&2
echo 'Working-directory upload and VM builds are retired. Adopt the existing installation, then select a verified tag.' >&2
exit 2
