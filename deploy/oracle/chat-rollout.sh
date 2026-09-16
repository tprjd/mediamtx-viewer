#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
compose() {
  docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml "$@"
}
set_flag() {
  CHAT_ENABLED=$1 compose up -d --no-deps --no-build --wait viewer
}
disable() {
  # Stop the broker so cached five-minute tokens cannot reconnect after rollback.
  compose stop centrifugo
  set_flag false
  sudo systemctl stop chat-capacity-rollback.timer 2>/dev/null || true
}
case ${1:-} in
  disable)
    disable
    ;;
  health)
    compose ps
    compose exec -T viewer node --input-type=module -e '
      const response = await fetch("http://127.0.0.1:3000/api/health");
      const health = await response.json();
      console.log(JSON.stringify(health));
      if (!response.ok || !["healthy", "disabled"].includes(health.chat.status)) process.exit(1)'
    ;;
  trial|enable)
    action=$1
    checks=${2:?Provide the checks report path relative to the repository}
    evidence=${3:?Provide the storage report for trial or capacity report for enable}
    mkdir -p .data/chat-rollout
    # Any failed gate must leave Chat disabled, including a failed enable after a trial.
    trap 'disable' 0
    compose up -d --no-deps --wait centrifugo
    python3 scripts/chat-capacity/host.py > .data/chat-rollout/host.json
    docker run --rm --network none -v "$PWD:/work:ro" -w /work node:24-alpine \
      node scripts/chat-capacity/rollout-gate.mjs "$action" "$checks" .data/chat-rollout/host.json "$evidence"
    if [ "$action" = trial ]; then
      # The VM stops a trial even if the workstation or SSH connection fails.
      sudo systemctl stop chat-capacity-rollback.timer chat-capacity-rollback.service 2>/dev/null || true
      sudo systemctl reset-failed chat-capacity-rollback.service 2>/dev/null || true
      sudo systemd-run --unit=chat-capacity-rollback --on-active=25m \
        /bin/sh "$PWD/deploy/oracle/chat-rollout.sh" disable
    fi
    set_flag true
    compose exec -T viewer node --input-type=module -e '
      const response = await fetch("http://127.0.0.1:3000/api/health");
      const health = await response.json();
      if (!response.ok || health.chat.status !== "healthy") process.exit(1)'
    if [ "$action" = enable ]; then
      sudo systemctl stop chat-capacity-rollback.timer 2>/dev/null || true
    fi
    trap - 0
    ;;
  *)
    echo 'Usage: chat-rollout.sh disable|health|trial CHECKS STORAGE|enable CHECKS CAPACITY' >&2
    exit 2
    ;;
esac
