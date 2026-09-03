#!/bin/sh
set -eu

config_path=${1:-deploy/oracle/secrets/mediamtx.yml}
mode=${2:-contract}
image=${MEDIAMTX_IMAGE:-bluenviron/mediamtx:1.20.1}
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/../.." && pwd)

if [ ! -f "$config_path" ]; then
  echo "MediaMTX configuration not found: $config_path" >&2
  exit 1
fi

case "$mode" in
  contract)
    node "$project_dir/scripts/validate-streaming-contract.mjs" "$config_path"
    ;;
  --syntax-only)
    ;;
  *)
    echo "Usage: $0 [mediamtx.yml] [--syntax-only]" >&2
    exit 2
    ;;
esac

validation_log=$(mktemp)
trap 'rm -f "$validation_log"' EXIT HUP INT TERM

set +e
timeout 3 docker run --rm --network none \
  -e MTX_UDPREADBUFFERSIZE=0 \
  -v "$(pwd)/$config_path:/mediamtx.yml:ro" \
  "$image" >"$validation_log" 2>&1
validation_status=$?
set -e

# A valid server remains running until timeout terminates the isolated check.
if [ "$validation_status" -eq 124 ]; then
  echo "MediaMTX configuration validated with $image"
  exit 0
fi

echo "MediaMTX configuration validation failed:" >&2
sed -n '1,120p' "$validation_log" >&2
exit 1
