# Create a verified maintenance backup

Use this command against the current Oracle installation. It requires no GitHub
release or image publication. Run it from a workstation checkout with `npm ci`
complete and Docker available. The Docker CLI must have access to the target host.

The command interrupts viewing and publishing. It stops Caddy to close public
requests and persistent connections. A separate Caddy container serves a static
`503` response. The command freezes the existing application containers, including
background writers, while it copies both databases and their SQLite WAL files.
It resumes those same processes after verification. Application startup migrations
do not run, and the effective Chat state stays unchanged.

## Prepare the workstation

1. Load `AUTH_BACKUP_KEY` into the workstation environment from your secret store.
   Use the same base64-encoded 32-byte key as the running Caddy container.
   Keep the key outside the backup directory. Do not put the key in command arguments.
2. Select the Docker host. For an SSH target, use this command:

   ```sh
   export DOCKER_HOST=ssh://ubuntu@YOUR_HOST
   ```

3. Create private workstation storage:

   ```sh
   mkdir -m 700 "$HOME/mediamtx-recovery"
   ```

4. Check the selected host:

   ```sh
   docker info
   docker ps --filter label=com.docker.compose.project=mediamtx-viewer
   ```

The command reads the effective Chat flag, container identities, database paths,
and backup key from the current containers. It rejects unhealthy or stopped
required services, a mismatched broker state, missing images, and mismatched keys.
The viewer must have no published ports. Caddy must use fixed public ports.
Both databases must share a persistent directory.

Use the updated restore scripts from this checkout for explicit restores.
The maintenance command also honors the lock used by already installed daily
backups and Chat restores. Do not run older authentication restore scripts or
other database tools concurrently.

## Run the backup cycle

Run the following command from the repository root:

```sh
node scripts/maintenance-backup.mjs backup \
	--project mediamtx-viewer \
	--directory "$HOME/mediamtx-recovery"
```

The command uses `https://PUBLIC_HOSTNAME/` for its public check. If you need a
different address, add `--url https://YOUR_HOST/`. The address must reach this
installation directly and must have a trusted TLS certificate.

The command checks database integrity, migration records, bytes, and available
inodes before maintenance. It reserves space for raw database and WAL copies,
SQLite snapshots, VACUUM work, encrypted copies, and temporary verification files.
It checks space again at the snapshot and workstation-copy boundaries. Existing
recovery files are never deleted to make space.

A successful command prints one JSON object with `result: "complete"`, the attempt
identifier, backup identifier, host manifest path, workstation manifest path,
application version, and effective Chat state. It exits with status zero only
after the previous release passes its health checks and the public proxy returns.
Enabled Chat must report `healthy`. Disabled Chat must remain `disabled`.

The encrypted files use the existing authenticated manifest and AES-256-GCM
format. The command copies both files and the manifest to a private attempt
directory on the workstation. It checks file sizes, checksums, the manifest
signature, authenticated decryption, SQLite integrity, foreign keys, and recorded
migrations. Temporary plaintext files have restricted access and are removed
when verification ends, including after a controlled error.

Expiry cleanup applies to the Chat snapshot. Maintenance backup creation does
not purge the live database. Normal runtime cleanup resumes with the application.
Existing restore-time Chat retention and compatibility checks still apply.

## Keep maintenance active for a later deployment

Add `--hold` to the backup command:

```sh
node scripts/maintenance-backup.mjs backup \
	--project mediamtx-viewer \
	--directory "$HOME/mediamtx-recovery" \
	--hold
```

Success prints `result: "verified-maintenance"`. Public access remains closed,
and writers remain frozen. The durable record is
`AUTH_DB_PATH`'s directory plus `/.maintenance-backup.json`. It contains the
verified backup locations, container identities, Chat state, phase, and database
fingerprints. It contains no key or private application configuration.

A later deployment can consume this completed phase while it holds the same
operation lock. It must validate the marker and frozen container identities
before migration or activation. A backup file alone is not an activation permit.
This ticket does not add migration or activation commands.

To resume a held cycle without changing the release, run this command:

```sh
node scripts/maintenance-backup.mjs resume \
	--project mediamtx-viewer \
	--attempt ATTEMPT_ID
```

Resume requires unchanged database files and the original container identities.
It checks the previous release before ending maintenance. It never restores or
replaces either database. A completed attempt cannot be resumed a second time.

## Handle a failed cycle

A failure exits with a nonzero status, even if the previous release resumes.
Read the JSON result and phase:

- `rejected`: the command did not enter maintenance. Correct the preflight failure.
- `failed-resumed`: the backup failed, but the unchanged previous release passed
  health checks and public access returned. Correct the backup failure and retry.
- `maintenance-retained`: recovery is uncertain or a health check failed. Keep
  public access closed. Inspect the marker and the named containers before repair.

For retained maintenance, use `docker inspect` locally to check the original
container identities and paused states. Inspect `/api/health` inside the viewer
only after an operator has established a safe recovery procedure. Check Chat
health separately from core health. Do not remove the marker or lock to bypass
these checks. Do not restart the viewer through its default command, which runs
startup migrations. Never select a database restore merely to clear a backup error.

The operation lock remains at `AUTH_BACKUP_DIR/.backup-lock`. Scheduled backups
and updated explicit restore commands reject an active lock or unresolved marker.
A workstation disconnect, host restart, or killed process requires operator
recovery. Automatic reconciliation for those cases belongs to deployment ticket 06.
A killed verification process can leave a private `.verify-*` directory. Remove
that directory only after you confirm that its process has stopped.

## Verify a retained workstation set

With the key in the environment, run:

```sh
node scripts/verify-backup.mjs /PRIVATE/PATH/manifest.json
```

Success prints `result: "verified"`. Failure prints a fixed error code and exits
with a nonzero status. This check does not authorize deployment or alter the host.

Host deployment sets live in `deployment-backups` beside the databases.
Workstation sets live under the selected private directory. Daily rotation only
uses `AUTH_BACKUP_DIR` and keeps its existing seven-day policy. A second daily
backup cannot remove a deployment set. Deployment sets have no automatic cleanup
in this command. The two-set retention policy belongs to deployment ticket 08.

## Run the command tests

Run Docker before the test command:

```sh
npm test -- scripts/database-backups.test.mjs
```

The existing backup suite builds disposable fixture services with real SQLite
files and encryption. Each installation has its own project name, network, and
volume. Tests exercise the same maintenance command used for the Oracle host.
They do not connect to Oracle, send notifications, or create production accounts.
A missing Docker daemon fails the suite.
