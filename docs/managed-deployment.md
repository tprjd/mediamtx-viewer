# Deploy a release without database migrations

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
The selected release must have the same migration names and SQL contents.
Pending migrations, changed history, and unreadable records stop deployment.
Controlled migration support is separate work in ticket 05.

The command serves static maintenance through a separate proxy and pauses
writers. It copies and verifies the encrypted backup on the workstation before
it stops the previous writers and starts the candidate. Neither candidate startup
nor rollback runs the image's migration command. Compose keeps the existing
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
ending maintenance. It never replaces either database.

If rollback fails or migration state is uncertain, the command retains maintenance,
its exclusive operation owner, and recovery files. Do not delete the owner or
maintenance marker to force another deployment. Reconnect and reboot recovery
is separate work in ticket 06. Retention cleanup is separate work in ticket 08.

## Verify with isolated fixtures

Run the command tests with a local Docker engine, SOPS, and age:

```sh
npx vitest run scripts/deploy-release.test.mjs
```

The fixtures use real container lifecycle operations, SQLite databases, encrypted
backup transfer, and HTTP requests. They control GitHub and registry responses.
They never connect to Oracle or send Discord notifications. A missing Docker
engine fails the tests.
