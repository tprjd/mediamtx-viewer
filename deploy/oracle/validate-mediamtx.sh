#!/bin/sh
set -eu

config_path=${1:-deploy/oracle/secrets/mediamtx.yml}
image=${MEDIAMTX_IMAGE:-bluenviron/mediamtx:1.20.1}

if [ ! -f "$config_path" ]; then
  echo "MediaMTX configuration not found: $config_path" >&2
  exit 1
fi

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
