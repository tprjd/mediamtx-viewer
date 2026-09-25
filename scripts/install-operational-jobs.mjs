import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { deploymentStdio } from './deployment-connection.mjs'

export async function installOperationalJobs(target, project) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid job project')
  const runner = readFileSync(new URL('../deploy/oracle/active-backup.sh', import.meta.url), 'utf8')
  // Only the application's existing backup unit is replaced. Other host jobs stay intact.
  const service = readFileSync(new URL('../deploy/oracle/mediamtx-backup.service', import.meta.url), 'utf8').replace('mediamtx-active-backup mediamtx-viewer', `mediamtx-active-backup ${project}`)
  const script = `set -eu
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cat > "$work/runner" <<'MANAGED_BACKUP_RUNNER'
${runner.trimEnd()}
MANAGED_BACKUP_RUNNER
cat > "$work/service" <<'MANAGED_BACKUP_SERVICE'
${service.trimEnd()}
MANAGED_BACKUP_SERVICE
privilege() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }
loaded=$(systemctl show --property=LoadState --value mediamtx-backup.service) || [ "$loaded" = not-found ]
case "$loaded" in loaded|not-found) ;; *) exit 1;; esac
if [ "$loaded" = loaded ]; then [ -z "$(systemctl show --property=DropInPaths --value mediamtx-backup.service)" ]; fi
privilege install -d -m 755 /usr/local/libexec
privilege install -m 755 "$work/runner" /usr/local/libexec/mediamtx-active-backup.next
privilege mv /usr/local/libexec/mediamtx-active-backup.next /usr/local/libexec/mediamtx-active-backup
if [ "$loaded" = loaded ]; then
  privilege install -d -m 700 /var/lib/mediamtx-deployment
  if [ ! -f /var/lib/mediamtx-deployment/legacy-backup.service ]; then
    systemctl cat mediamtx-backup.service > "$work/legacy"
    privilege install -m 600 "$work/legacy" /var/lib/mediamtx-deployment/legacy-backup.service
  fi
  privilege install -m 644 "$work/service" /etc/systemd/system/mediamtx-backup.service.next
  privilege mv /etc/systemd/system/mediamtx-backup.service.next /etc/systemd/system/mediamtx-backup.service
  privilege systemctl daemon-reload
  systemctl cat mediamtx-backup.service | grep -F '/usr/local/libexec/mediamtx-active-backup ${project}' >/dev/null
fi`
  try { execFileSync(target === 'local' ? 'sh' : 'ssh', target === 'local' ? ['-s'] : [target, 'sh -s'],
    { input: script, stdio: ['pipe', ...deploymentStdio().slice(1)], timeout: 30000 }) }
  catch { throw new Error('Adoption scheduled job installation failed; repair the backup unit and retry adoption') }
}
