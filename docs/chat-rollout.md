# Enable Chat after capacity verification

Run these commands from the repository root. Keep the publisher running on the selected live Channel throughout the capacity test. Obtain approval before adding load accounts and visible test messages.

## Prepare the host

Keep `CHAT_ENABLED=false` in the encrypted deployment secrets. Configure separate 32-byte secrets for `CHAT_TAG_HMAC_SECRET`, `CENTRIFUGO_TOKEN_HMAC_SECRET`, and `CENTRIFUGO_API_KEY`. Configure `AUTH_BACKUP_KEY` as a base64-encoded 32-byte key. Follow [the backup procedure](chat-operations.md#back-up-authentication-and-chat) to install the daily timer.

Inspect available memory, CPU use, and free disk before deployment. The gate requires at least 1 GiB available memory and no more than 70% sampled CPU use. If old Docker build cache consumes disk, remove only unused cache with `docker builder prune --force --filter until=168h`. Do not remove application volumes.

Run `npm run chat:rollout-checks -- .data/chat-checks.json`. The command runs lint, type checking, the full unit suite, browser tests, the independent restore drill, the production webpack build, Streaming contract validation, both Compose flag states, and WebSocket authentication through the production proxy configuration. A failed command stops verification. Repair the failure and rerun the affected checks before producing a complete report. Do not edit a failed report to mark it passed.

The report contains a hash of the source files. Deploy the same source with `deploy/oracle/deploy.sh`. The viewer image records that hash. Deployment removes obsolete files only from the application source directories. It preserves secrets and operational state. The rollout gate refuses a different image source. Deployment sets Chat to disabled and stops Centrifugo, even if an older environment file contains an enabled flag. Do not change the application version for this verification task.

Create a storage report:

```sh
node --input-type=module -e 'import {measureStorageBudget} from "./scripts/chat-capacity/storage.mjs"; console.log(JSON.stringify(await measureStorageBudget()))' > .data/chat-storage.json
```

This check writes 700,000 synthetic messages with 500 ASCII characters each through the production schema and indexes. It creates an encrypted backup with the production backup code. It reserves seven backup sets, a replacement set, and two snapshot copies. The disk gate adds 25% for WAL growth and moderation data, reserves authentication backups, and preserves the configured free-disk minimum. This is a normal-volume budget. Combined Unicode characters can require more bytes. Monitor actual growth and keep the runtime storage limits enabled.

Copy the checks and storage reports to `.data/` on the VM. Inspect the pinned Centrifugo image on the ARM64 host. Require a healthy container before the trial. The image version and digest must match `deploy/oracle/docker-compose.yml` and `scripts/e2e-centrifugo.mjs`.

## Run a bounded trial

Create a private configuration file on the workstation. Set its mode to `600`. Use this structure:

```json
{
  "origin": "https://frankerzspam.duckdns.org",
  "channel": "live",
  "sshTarget": "ubuntu@158.180.29.172",
  "remoteDirectory": "/home/ubuntu/mediamtx-viewer",
  "participants": [{"cookie": "AUTHENTICATED_COOKIE_HEADER"}]
}
```

To create temporary accounts on the VM, run the following command after the trial starts:

```sh
docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml exec -T -e CHAT_CAPACITY_ACCOUNTS=confirmed viewer node scripts/chat-capacity/accounts.mjs create /data/chat-capacity-accounts.json
```

Copy the `participants` array from the private `/data/chat-capacity-accounts.json` file into the workstation configuration. The accounts have no password. Their signed sessions expire after two hours. Keep the account record until cleanup finishes.

Supply 100 participant entries. Use at least 20 distinct active accounts so ten accepted submissions per second comply with the per-account rate limit. The driver opens one connection per entry and a real playback browser. Use `browserExecutable` if the live codec requires an installed browser. Keep cookies, configuration files, and account provisioning records out of Git and operational logs.

On the VM, start a trial:

```sh
sh deploy/oracle/chat-rollout.sh trial .data/chat-checks.json .data/chat-storage.json
```

The command checks the verification report, image source, service health, memory, database integrity, outbox, and storage budget. It enables Chat only after these checks pass. A host timer disables Chat after 25 minutes if the workstation disconnects or verification does not finish.

On the workstation, run:

```sh
npm run chat:capacity -- .data/chat-capacity-config.json .data/chat-capacity-report.json
```

The driver sends 9,000 messages at 100-millisecond intervals over 15 minutes. It measures delivery to every connection, 100-message history pages, reconnects, and room-sequence reconciliation beyond the broker cache. It records Channel status latency and freshness, SSE heartbeat timing, video progress, playback interruptions, CPU, memory, disk, database size, container health, and outbox depth. It checks steady state after load stops. Missing observations or failed gates produce a nonzero exit status and request an immediate rollback through SSH. The host timer remains the fallback if SSH fails.

Do not treat fixture playback, a short run, missing recipients, or absent measurements as a capacity pass. The playback gate rejects interruptions conservatively. Investigate any failure before rerunning the test.

## Enable Chat

Copy the successful capacity report to the VM. Run:

```sh
sh deploy/oracle/chat-rollout.sh enable .data/chat-checks.json .data/chat-capacity-report.json
sh deploy/oracle/chat-rollout.sh health
```

The enable command rechecks all measured capacity thresholds and current host health. It requires reports less than 24 hours old and the same viewer image and Centrifugo pin. It cancels the trial rollback timer only after Chat health passes. A failed enable attempt disables Chat.

The flag applies to every live Channel. Open watch pages check the flag every ten seconds and on focus. Offline and unavailable Channels keep their existing watch states. Container restarts preserve the selected flag. A later deployment sets `CHAT_ENABLED=false` and requires fresh verification.

Disable the temporary test accounts after the run:

```sh
docker compose --env-file deploy/oracle/secrets/caddy.env -f deploy/oracle/docker-compose.yml exec -T -e CHAT_CAPACITY_ACCOUNTS=confirmed viewer node scripts/chat-capacity/accounts.mjs disable /data/chat-capacity-accounts.json
```

The command deletes their sessions and disconnects their sockets if Chat is enabled. Keep the disabled database account records while retained messages refer to them. Remove the private account file and workstation cookie configuration after cleanup. The normal seven-day cleanup removes test content.

## Roll back or recover

To disable Chat immediately:

```sh
sh deploy/oracle/chat-rollout.sh disable
sh deploy/oracle/chat-rollout.sh health
```

Rollback recreates only the viewer with Chat disabled and stops Centrifugo. Stopping Centrifugo closes sockets and prevents cached tokens from reconnecting. Open watch pages restore the placeholder on their next flag check. The command retains the Chat database, migrations, backup sets, and authentication data. It does not restart MediaMTX. Viewer recreation temporarily interrupts authentication requests and can interrupt playback. The live deployment check observed a player-continuity failure during flag changes. Plan flag changes as service maintenance; this procedure does not provide uninterrupted viewer deployment.

If Chat storage needs recovery, keep Chat disabled and follow [Restore Chat independently](chat-operations.md#restore-chat-independently). Repeat the restore drill and all failed gates before a new trial. Never delete a maintenance marker or lower a disk threshold to bypass a failed gate.
