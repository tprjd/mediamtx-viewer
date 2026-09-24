# Chat operations

## Delivery and storage

Centrifugo owns long-lived browser connections and live event delivery. Next.js
owns account access, validation, rate limits, moderation, and retained history.
This keeps connection management separate from the viewer process without
adding another account system or a custom connection service.

Browsers receive events over WebSocket with five-minute connection tokens.
They submit messages and moderation commands through authenticated Next.js HTTP
endpoints. Next.js assigns the visible Chat room and a private participant
control channel. Browsers cannot choose subscriptions or publish to Centrifugo.

`chat.sqlite` stores messages, restrictions, moderation records, rate limits,
delivery outbox entries, and room sequences. Authentication stays in
`auth.sqlite` because Chat has different write, retention, backup, and failure
requirements. The application validates account and Channel references on each
request. The databases have no cross-database foreign keys.

Next.js commits each accepted message and its outbox event in one transaction.
It retries delivery after a Centrifugo failure. Increasing room sequences and
client idempotency keys let clients order messages, reconcile gaps, and remove
duplicates. Private restriction events stay on the participant control channel.

Centrifugo uses its single-node memory engine, with recovery limited to 300
publications for 30 seconds. SQLite remains authoritative. Clients reconcile
from SQLite when recovery fails or a room sequence has a gap. Redis becomes
necessary only if multiple realtime service instances are needed.

Closed Chat interfaces hold no Centrifugo connections. Disabling an account
disconnects its clients. Centrifugo restarts and Chat failures must leave
playback and Channel status independent. Clients reconnect, refresh tokens,
and reconcile from their last room sequence.

All Chat rooms use the same message, rate, retention, and moderation rules.
The deployment flag applies to every live Channel. Follow the
[rollout procedure](chat-rollout.md) to enable or disable Chat.

## Author privacy

Each message stores its author's internal account ID and the profile name at
submission time. Public messages show that name and a stable Chat author tag
derived from a keyed hash of the account and Chat room IDs. Tags start at four
characters. A collision extends only the newer participant's tag.

Keep `CHAT_TAG_HMAC_SECRET` stable. Rotate it only for an intentional tag reset.
Chat must not expose account usernames, email addresses, or raw account IDs.
Profile names are public and need not be unique. Admin and Owner badges show
current roles, not roles stored with historical messages.

## Health

`GET /api/health` reports core health and a separate `chat` object. A Chat fault does not change the HTTP status when core viewing is healthy.

| Chat status   | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `disabled`    | `CHAT_ENABLED` is not `true`.                                                                   |
| `healthy`     | Chat storage and the Centrifugo API are available, with no pending deliveries or storage limit. |
| `degraded`    | Centrifugo is unavailable, deliveries are pending, or a storage limit prevents new submissions. |
| `unavailable` | The Chat database or required Chat configuration is unavailable.                                |

The administrator's Statistics page shows each active fault, its start time, pending deliveries, the oldest pending delivery, and storage measurements. A fault becomes sustained after five minutes. The viewer checks Chat health every ten seconds. Fault start times in Statistics reset when the viewer process restarts.

Centrifugo has an independent container health check. Caddy does not wait for Chat health before it starts. The viewer's container startup permits a failed Chat migration and reports Chat health separately. `npm run chat:migrate` still fails if the migration fails. After you repair storage, run this command again before you restore Chat service.

## Storage limits

Set these environment variables on the viewer service. Both values must be positive integers in bytes.

| Variable                    | Default                  | New submissions stop when                      |
| --------------------------- | ------------------------ | ---------------------------------------------- |
| `CHAT_DATABASE_LIMIT_BYTES` | `2147483648`, or 2 GiB   | Chat storage reaches or exceeds the limit.     |
| `CHAT_MINIMUM_FREE_BYTES`   | `10737418240`, or 10 GiB | Available filesystem space is below the limit. |

Chat storage includes the database and its write-ahead log. The check also counts committed pages that have not reached the main database file. The submission transaction checks both limits before it stores a new message. A retry can still retrieve an accepted message. Invalid limits or failed storage measurements stop new submissions.

At a limit, Chat keeps retained history readable and pauses sending. Moderation remains available if the database can accept commands. When the database fails, Chat keeps loaded messages visible and disables sending and moderation. A Centrifugo outage permits durable submissions and shows delayed delivery. These states do not change playback settings or Channel status.

## Discord alerts

The existing Discord notifier polls Chat health independently of the Channel event stream. Each fault must remain active for five minutes before the notifier sends an alert. Repeated checks do not repeat that alert. When an alerted fault clears, the notifier sends one recovery alert. Short faults do not produce an alert or a recovery message. If a failed database check prevents a storage or outbox check, the previous fault stays unresolved until a successful check confirms recovery.

The notifier stores Chat alert state at `${STATE_FILE}.chat` on its existing persistent volume. A notifier restart preserves alert state. Failed Discord requests are retried on the next check. Pending outbox entries count as a fault until the queue drains. A brief queue after a submission therefore does not cause an alert.

## Operational logs

Chat health logs contain fixed event types, fault codes, and results. Chat migration and alert failures use fixed error codes. The Centrifugo container uses the `warn` log level. Do not enable request-body or debug logging for Chat.

Operational logs must not contain message content, profile names, private notes, tokens, cookies, or client idempotency keys. The log-capture tests exercise successful publication, rejected requests, and failures against the pinned Centrifugo image.

## Troubleshoot local Chat tests

Run these checks from the repository root with Docker running:

```sh
docker version
npm test -- 'app/api/channels/[slug]/chat/messages/route.test.ts' lib/chat-realtime.integration.test.ts
```

`docker version` must report a server version as well as a client version.
If it cannot connect, start the local Docker daemon and check `docker context show`.
Check whether `DOCKER_HOST` points to the intended daemon. Do not change the
production Chat configuration to repair a local Docker connection.

The realtime suite starts and removes its own Centrifugo container. Docker
launch failures and early container exits include startup diagnostics with
the test secrets redacted. A process that stays running without a healthy
endpoint fails after 20 seconds. If the image download is too slow, pull the
exact image pinned in `lib/chat-realtime.integration.test.ts` before retrying.
Do not treat skipped tests after a setup failure as a passing suite.

The messages route unit tests replace the moderator-role lookup with a test
double, along with the other database dependencies. They do not require a local
authentication database. A `no such table: user` error in these unit tests means
a real database call escaped the test setup. Check the test doubles instead of
migrating a development database to make the unit tests pass. Actual database
failures must still produce the route's `503` response.

After the focused tests pass, run `npm test` for the full suite. Local tests do
not replace the [capacity and rollout checks](chat-rollout.md).

## Clear one Channel's Chat history

Apply Chat migrations with `npm run chat:migrate` before starting the updated application.
Migration 007 adds the room clearing boundary and content-free submission receipts.

As an administrator, open the Channel's Chat panel and select **Clear Chat history**
(the trash icon). Check the Channel name, then select **Confirm clearing**. Cancel
leaves history unchanged. Channel owners without administrator status cannot clear history.

Clearing deletes stored messages, including retained originals of removed messages,
and removes their queued delivery content. It preserves participant tags, restrictions,
moderation records, and the existing private-note retention policy. New messages remain
available. Retrying an accepted, cleared submission does not recreate it.

If realtime delivery fails, the dialog shows **Messages deleted. Updating connected
participants…**. The server retries recovery-history invalidation and publication.
The dialog closes after that work succeeds. You can close the dialog while retries
continue. Check Chat health and the outbox if the pending state persists.

Existing backups expire under the normal policy. Restoring a compatible older backup
can restore cleared messages that have not expired. Restore still deletes expired
content. Clearing does not guarantee forensic erasure of filesystem copies or backups.

## Back up authentication and Chat

Set `AUTH_BACKUP_KEY` to a base64-encoded 32-byte key in the encrypted deployment secrets. Keep this key outside the backup directory. Keep `CHAT_TAG_HMAC_SECRET` with those secrets so restored author tags keep their identity.

Run `npm run auth:backup` with both database paths and `AUTH_BACKUP_DIR` configured. The existing command now backs up both databases. It prints the path to `manifest.json` after both encrypted files are complete.

Each set has one directory, one identifier, an authenticated manifest, and separate AES-256-GCM files for authentication and Chat. The manifest records creation time, database selection, migration names, file sizes, checksums, and encryption parameters. The command validates the complete set before it permits either restore.

The job keeps the newest complete set from each of seven days. A second backup on the same day replaces that day's earlier set. Rotation removes whole sets. Incomplete sets and abandoned temporary directories do not count toward retention. A failed backup leaves the previous complete sets in place. Complete sets that fail validation stay on disk for administrator inspection. Sets encrypted with another key also stay outside rotation. Legacy authentication-only backup files remain outside this rotation.

Install the daily timer on the Oracle host after you set `AUTH_BACKUP_KEY` in `deploy/oracle/secrets/caddy.env` and encrypt the updated secrets:

```sh
sudo install -m 644 deploy/oracle/mediamtx-backup.service deploy/oracle/mediamtx-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mediamtx-backup.timer
sudo systemctl start mediamtx-backup.service
sudo journalctl -u mediamtx-backup.service -n 20
```

The service uses `/home/ubuntu/mediamtx-viewer`. Change its paths if the deployment uses another directory. The timer runs daily at 03:00 UTC, with up to five minutes of delay. Remove any earlier authentication backup schedule to prevent duplicate jobs.

For a stable pair with stopped writers and a verified workstation copy, use the
[maintenance backup command](maintenance-backups.md). Deployment sets are separate
from the daily seven-day rotation.

## Restore Chat independently

Keep the viewer and Centrifugo running. Run the following command inside the viewer container with the backup key available:

```sh
CHAT_RESTORE_CONFIRM=replace AUTH_BACKUP_KEY="$AUTH_BACKUP_KEY" \
	node scripts/restore-chat.mjs /data/backups/SET_ID/manifest.json
```

The command uses `INTERNAL_AUTH_SECRET` to request a restore through the application. `CHAT_RESTORE_URL` defaults to `http://127.0.0.1:3000`. Use the internal viewer address. Do not send the secret through a public proxy.

The application blocks Chat requests and token issuance while it restores. It drains pending publication work, validates the schema and account and Channel references, and deletes expired content. Missing references reject the restore. The administrator must select a compatible set or repair the references before trying again.

The application clears Centrifugo recovery history and discards the restored delivery queue. After it replaces Chat storage, it checks retention again and reconnects participants. Clients reload the current transcript and restrictions. The authentication database, account sessions, Channel status, and player stay available.

If a restore fails, Chat remains unavailable. Correct the cause, then run the same restore command again. The maintenance marker survives a viewer restart. Do not delete this marker to bypass validation.

A process crash can leave a backup or restore lock directory. Confirm that the command and application restore have stopped before removing `AUTH_BACKUP_DIR/.backup-lock` or `CHAT_DB_PATH.restore-lock`. A failed restore can also leave `CHAT_DB_PATH.restore-candidate`. Keep it private. A retry replaces it, and a successful restore removes it.

## Restore authentication independently

Stop the viewer before replacing authentication storage. Use the same manifest and `AUTH_BACKUP_KEY` with `AUTH_RESTORE_CONFIRM=replace node scripts/restore-auth.mjs /data/backups/SET_ID/manifest.json` in a one-off container. This command leaves Chat storage unchanged. It keeps the replaced authentication files beside the restored database. Legacy `auth-*.sqlite.enc` files are also accepted.

## Verify a restore before rollout

Run `npx playwright test --project=chat-chromium --grep 'restore drill'` with Docker available. The drill uses an encrypted older set, blocks Chat during a failed Centrifugo operation, retries the restore, and checks expiry deletion and live delivery after reconnect. It also checks the existing account session and continued video progress without a player reset. The media fixture and MediaMTX status server are local test fixtures. Run the production capacity gate with a real Channel before enabling Chat.

Chat cleanup also runs at application startup and once per hour, including when Chat is disabled. Each daily backup runs cleanup before taking the Chat snapshot. Maintenance backups apply cleanup only to the snapshot. Messages, retained originals of removed messages, and queued content expire seven days after submission. Private notes expire seven days after the moderation action. Structured Chat moderation records and active bans remain until an authorized action clears them.

Seven-day retention gives participants recent context and moderators short-term
evidence. Longer-lived moderation records preserve accountability without
retaining expired message content or private notes.
