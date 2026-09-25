# Deploy a release and recover from migration failure

This opt-in command stages a verified release, creates a maintenance backup,
and activates the selected images. It preserves the effective Chat state.
The existing VM-build procedure remains the default.

## Check the prerequisites

Use this command only with a verified managed baseline. It rejects an unmanaged
installation. Adoption of an existing installation is separate work in ticket 09.
Do not create a baseline record by hand to bypass this check.

The baseline contains the exact service images, resolved Compose model, private
configuration and scripts, environment, volume mounts, and both migration histories. Before activation, the command also records
the user, group, and mode of persistent-volume directories and files.
Its viewer starts with `node server.js`, without startup migrations. Managed
services have restart retries disabled. The command checks the baseline files
and running containers before maintenance.

Install the [preparation tools](deployment-preparation.md#prepare-the-workstation).
Load `AUTH_BACKUP_KEY` into the workstation environment from private storage.
It must match the host backup key. Use a private workstation directory with
mode `0700`. Keep encryption keys separate from backup copies.

## Deploy the selected tag

Run this command from the repository:

```sh
sh deploy/oracle/deploy.sh managed ubuntu@your-host vX.Y.Z
```

Use `--project NAME` for a different Compose project. Use `--directory PATH`
for private workstation staging and backup storage. The default directory is
`~/.local/share/mediamtx-deployments`. The optional `--url URL` selects the
public proxy URL to check. It defaults to the previous proxy's public hostname.
`local` selects the local Docker endpoint for isolated tests.

The command downloads the committed source, decrypts its private configuration,
and verifies the release evidence and downloaded image identities. It checks
host resources and available storage. It does not request capacity reports or
run synthetic storage benchmarks. Runtime storage limits remain active.

Both databases must contain exactly the baseline's applied migration records.
The selected release can add migration files after the existing sequence. It must
preserve the names and SQL contents of existing files. Changed history and
unreadable records stop deployment.

The command serves static maintenance through a separate proxy and pauses
writers. It copies and verifies the encrypted backup on the workstation before
it stops the previous writers. The deployment owner runs authentication migrations,
then Chat migrations, once in separate containers. Chat migration failure fails
deployment even when Chat is disabled. Ordinary application startup keeps its
existing optional Chat migration behavior. Neither candidate startup nor rollback
runs the image's migration command. Compose keeps the existing
project and persistent volumes. Changed mounts cause service recreation.
Unchanged services can remain running when their resolved configuration matches.

Acceptance checks the selected version, service image identities, required
service health, database integrity, and proxy behavior. Public ports stay closed during private
acceptance. After the port handoff, the command checks public login and protected
routes and the final service state. Enabled Chat must report
healthy status and have no pending deliveries within the bounded health wait.
Disabled Chat keeps its broker stopped. Credential rotation is a separate operation.

## Inspect the result

Run the status command with the same project:

```sh
sh deploy/oracle/deploy.sh status ubuntu@your-host
```

The command reports one of these deployment results:

| Result | Exit status | Required action |
| --- | --- | --- |
| `active` | Zero | The selected release passed acceptance. |
| `recovered` | Zero | The explicitly selected recovery passed acceptance. |
| `rejected` | Nonzero | Correct the failed preflight or backup check. |
| `failed-rolled-back` | Nonzero | The previous release passed rollback checks. Repair the candidate before retrying. |
| `maintenance-required` | Nonzero | Keep access closed. Inspect the failed phase and recovery records before explicit recovery. |

The host stores durable phase records in the private staging volume under
`deployments/ATTEMPT.json`. It keeps the previous runtime record in
`deployments/ATTEMPT-previous.json`. `current.json` identifies the accepted runtime.
The previous record and resolved Compose files contain secrets. Do not publish them.
The deployment result identifies the verified host and workstation backup copies.

Automatic rollback stops the candidate and checks both migration histories again.
It restores the previous images, environment, and mounted files only when the
histories remain known and unchanged. Changed volume ownership blocks automatic
rollback. The command compares the restored runtime with its recorded baseline
and checks the restored release before
ending maintenance. It never replaces either database. A new committed migration in either database
blocks automatic rollback, including when a later file fails. The command stops
each migration container before it reads both histories. Missing databases,
changed existing records, and uncertain process completion keep maintenance active.

If rollback fails or migration state is uncertain, the command retains maintenance,
its exclusive operation owner, and recovery files. Do not delete the owner or
maintenance marker to force another deployment. Reconnect and reboot recovery
is separate work in ticket 06. Retention cleanup is separate work in ticket 08.

## Recover while maintenance is active

Read status first. It reports the failed phase, added or changed migration records,
the candidate and previous releases, and both verified backup locations.
A new `managed` command cannot replace data or bypass the retained deployment owner.

To retry acceptance of a fully migrated candidate without replacing data, run:

```sh
sh deploy/oracle/deploy.sh recover ubuntu@your-host --release candidate --restore none
```

If migration failed partway through its sequence, this command rejects the
incomplete schema. Inspect and repair the failure before you select recovery.
Recovery does not run migrations again or change migration history.

A database restore can discard data written after the backup. To restore only
authentication and select the previous release, run:

```sh
sh deploy/oracle/deploy.sh recover ubuntu@your-host --release previous --restore auth --confirm discard-later-data
```

Use `--restore chat` for Chat only, or `--restore both` for both databases.
Use `--restore none` to preserve both. Each command requires an explicit release
and database choice. The same project, directory, and URL options apply.

Recovery uses the verified host backup identified by the failed attempt. It checks
backup authentication, decryption, database integrity, the selected release's
migration schema, and Chat references to accounts and Channels. It validates the
pair before replacement. An unselected database must already match the selected
release. There is no general guarantee that old code supports a newer schema.

Recovery retains replaced database files and their WAL files beside the database
under `.pre-restore-UUID` names. A restored Chat database has expired content
removed and pending deliveries cleared. Its transcript generation changes.
The broker restarts with empty in-memory history before access opens.

Recovery runs offline with the previous application and candidate stopped.
It requires Docker access, not public application access. It keeps the maintenance
proxy active through database validation and private application acceptance.
If any recovery check fails, maintenance remains active. Recheck status before
another explicit recovery command. An interrupted database replacement can leave
only part of the selected pair restored. Its retained files and verified backup
remain available for inspection and another explicit recovery choice.

## Verify with isolated fixtures

Run the command tests with a local Docker engine, SOPS, and age:

```sh
npx vitest run scripts/deploy-release.test.mjs
```

The fixtures use real container lifecycle operations, SQLite databases, encrypted
backup transfer, and HTTP requests. They control GitHub and registry responses.
They never connect to Oracle or send Discord notifications. A missing Docker
engine fails the tests.
