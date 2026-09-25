import { execFileSync } from 'node:child_process'
import { deploymentStdio } from './deployment-connection.mjs'

// The old trial used these two transient systemd units. Do not touch backup
// timers, deployment records, or database maintenance markers.
const cancel = `set -eu
for unit in chat-capacity-rollback.timer chat-capacity-rollback.service; do
  loaded=$(systemctl show --property=LoadState --value "$unit") || [ "$loaded" = not-found ]
  case "$loaded" in
    not-found) ;;
    loaded)
      if [ "$(id -u)" = 0 ]; then systemctl stop "$unit"; else sudo -n systemctl stop "$unit"; fi
      ;;
    *) exit 1 ;;
  esac
done`
export function cancelChatTrial(target) {
  try {
    execFileSync(target === 'local' ? 'sh' : 'ssh', target === 'local' ? ['-c', cancel] : [target, cancel],
      { stdio: deploymentStdio(), timeout: 30000 })
  } catch { throw new Error('Managed obsolete Chat trial cancellation failed') }
}
