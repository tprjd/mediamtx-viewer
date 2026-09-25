# Adopt the existing installation

Adoption records the existing Compose installation as the recovery baseline for
its first managed deployment. It preserves the VM, project, containers, named
volumes, effective Chat state, and application data. It does not publish a release
or claim that the legacy images passed GitHub verification.

## Prepare

Use the workstation tools in [release preparation](deployment-preparation.md).
Load the existing `AUTH_BACKUP_KEY` into the workstation environment. It must
match the key in the running Caddy container. The target must permit Docker
commands and noninteractive sudo for the application-owned backup service.

All seven services must exist. Services must be healthy, with Centrifugo stopped
when Chat is disabled. Both databases and their migration files must be readable
and consistent. The viewer image must contain `server.js` and the backup tools.
Unsupported runtime settings, writable bind mounts, uncertain ownership, or a
changed installation stop adoption with a repair action.

Before production use, complete the isolated deployment tests and the hosted
release verification workflow. Tag publication never activates Oracle.

## Capture the baseline

Run from the workstation:

```sh
sh deploy/oracle/deploy.sh adopt TARGET
sh deploy/oracle/deploy.sh status TARGET
```

Use `--project NAME` for a nondefault project. Use the same project for all later
commands. `local` is available for isolated Linux Docker installations.

Adoption captures actual image IDs, container configuration, environment secrets,
mounted file contents, migrations, and persistent-volume ownership. Captured
files stay in private host storage. The baseline records `githubVerified: false`.
Adoption checks the database state, image architecture, application health,
active proxy configuration, host resources, and disk space. It rechecks captured
files and container identity before it publishes the baseline.

Adoption disables automatic container restart without restarting the services.
This prevents a reboot during the first maintenance attempt from restarting
writers or startup migrations. Managed recovery starts the captured images with
`node server.js`, disables restart retries, and uses the captured bind files.
It compares the resulting runtime with the captured identities after these
intentional changes. Do not restart managed containers through the old checkout.

Only the obsolete application-owned capacity trial units are cancelled. Adoption
replaces the existing `mediamtx-backup.service` command with a stable launcher.
It retains the previous unit privately and leaves the daily timer schedule alone.
Service drop-ins require operator repair before adoption. Other host units are
not changed. If no backup service exists, adoption installs the launcher but does
not enable a new timer. Follow [backup setup](chat-operations.md#back-up-authentication-and-chat)
when a schedule is required.

A failed adoption does not activate a different application or replace data.
It can leave restart retries disabled or the backup launcher installed. Failed
and interrupted adoption retain the owner. Repair the reported condition, then
resume with:

```sh
sh deploy/oracle/deploy.sh recover TARGET --release previous --restore none
```

This resumes capture when no baseline was published. If adoption had completed,
recovery checks or restores that baseline without database replacement.

## Deploy a verified tag

```sh
sh deploy/oracle/deploy.sh TARGET vX.Y.Z
```

The selected-tag command is the normal entry point. `managed TARGET vX.Y.Z`
remains an equivalent explicit form. The unversioned upload and VM-build command
is retired and fails before host access.

The first deployment uses the same staging, resource checks, maintenance,
verified encrypted workstation backup, migration tracking, acceptance, rollback,
and recovery rules as later deployments. The adopted baseline is its previous
release. No database is restored automatically. See [managed deployment](managed-deployment.md),
[recovery](deployment-recovery.md), and [retention](deployment-retention.md).

Adoption preserves an enabled Chat service. Chat health and disable remain
available. Enabling Chat requires a deployed release with current GitHub
verification evidence, so an unverified adopted baseline cannot authorize enable.
The capacity target remains unverified.

## Verify in isolation

Short checks cover runtime-model rejection and the active backup launcher:

```sh
npx vitest run scripts/adoption-model.test.mjs scripts/active-backup.test.mjs
```

Long Docker checks capture a legacy-layout fixture with both Chat states, run the
installed backup launcher, deploy, and recover an eligible failure:

```sh
npx vitest run scripts/adoption-docker.test.mjs
```

Run the existing migration, interrupted recovery, restart, retention, proxy,
browser, backup, and hosted ARM64 checks before production rollout. A short test
pass does not establish the complete deployment path.
