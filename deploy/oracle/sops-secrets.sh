#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plain_dir="$script_dir/secrets"
encrypted_dir="$script_dir/secrets.enc"

secrets="
caddy.env
admin.env
mediamtx.yml
oci-usage.env
oci-usage-api-key.pem
discord.env
credentials.txt
"

sops_age_key_file=${SOPS_AGE_KEY_FILE:-"$HOME/.config/sops/age/keys.txt"}

usage() {
  echo "Usage: $0 encrypt" >&2
  echo "       $0 decrypt <target-directory>" >&2
  exit 2
}

require_tools() {
  command -v sops >/dev/null 2>&1 || {
    echo "sops is required but not found on PATH" >&2
    exit 1
  }
  command -v age >/dev/null 2>&1 || {
    echo "age is required but not found on PATH" >&2
    exit 1
  }
  if [ ! -f "$sops_age_key_file" ]; then
    echo "Age private key not found at $sops_age_key_file" >&2
    echo "Set SOPS_AGE_KEY_FILE to its path, or generate one with:" >&2
    echo "  age-keygen -o $sops_age_key_file" >&2
    exit 1
  fi
}

encrypt_secrets() {
  mkdir -p "$encrypted_dir"
  for name in $secrets; do
    if [ ! -f "$plain_dir/$name" ]; then
      echo "Missing plaintext secret: $plain_dir/$name" >&2
      exit 1
    fi
    SOPS_AGE_KEY_FILE="$sops_age_key_file" \
      sops encrypt \
        --input-type binary \
        --output-type binary \
        "$plain_dir/$name" > "$encrypted_dir/$name.enc"
    chmod 600 "$encrypted_dir/$name.enc"
    echo "encrypted $name"
  done
}

decrypt_secrets() {
  target_dir=${1:-}
  [ -n "$target_dir" ] || usage
  mkdir -p "$target_dir"
  for name in $secrets; do
    encrypted_file="$encrypted_dir/$name.enc"
    if [ ! -f "$encrypted_file" ]; then
      echo "Missing encrypted secret: $encrypted_file" >&2
      exit 1
    fi
    SOPS_AGE_KEY_FILE="$sops_age_key_file" \
      sops decrypt \
        --input-type binary \
        --output "$target_dir/$name" \
        "$encrypted_file"
    chmod 600 "$target_dir/$name"
    echo "decrypted $name"
  done
}

require_tools

case "${1:-}" in
  encrypt)
    encrypt_secrets
    ;;
  decrypt)
    decrypt_secrets "${2:-}"
    ;;
  *)
    usage
    ;;
esac
