# Prepare a selected release

Preparation downloads and checks a release. It does not enter maintenance,
activate a release, or run migrations. [Adopt an existing installation](adopt-installation.md)
before its first managed activation. Use the [selected-tag command](managed-deployment.md)
to deploy after preparation.

## Prepare the workstation

Install Node.js, Git, Docker CLI with Compose, SOPS, and age. The SSH target must
permit Docker commands. Keep the age private key on the workstation at
`~/.config/sops/age/keys.txt`, or set `SOPS_AGE_KEY_FILE` to its path.

The selected tag must have a published `release.json` from a successful
**Verified ARM64 release** workflow attempt. Preparation accepts appended
verification records only when they preserve the original release identity.

The existing installation must have all seven managed services and its original
Compose project and named volumes. The viewer must report healthy core status
and the expected Chat status. Disabled Chat requires a stopped broker.

## Prepare the release

Run the following command from the repository:

```sh
sh deploy/oracle/deploy.sh prepare ubuntu@your-host vX.Y.Z
```

The command fetches the selected tag from GitHub. Local source changes do not
enter the release. SOPS decrypts the secrets from that committed source on the
workstation. The command checks the source fingerprint, tag object, commit,
version, workflow evidence, and exact application image digests.

If verification is older than 24 hours, run **Verified ARM64 release** with mode
`refresh`. Select the release tag in both the tag input and **Use workflow from**.
This tests the existing images without rebuilding or replacing them.

A JSON result of `ready` means preparation passed at the reported attempt.
The report identifies the selected release, commit, application images, effective
Chat state, and staging volume. It does not authorize later activation without
new host and storage checks. A rejected preparation returns a nonzero exit code.

The command stores private configuration under an attempt directory in the Docker
volume `mediamtx-viewer-deployment-staging`. It retains the resolved Compose model
and release record there. Application images use the verified registry digests.
Other service images resolve to their downloaded identities. The model preserves
the Compose project, persistent volumes, effective Chat flag, and runtime storage
limits. It contains secrets. Do not print or publish it.

Temporary workstation plaintext is removed when the command completes or fails.
An abrupt process termination can leave a private `.prepare-*` directory. Inspect
and remove that directory only after its preparation process has stopped.

## Inspect preparation status

```sh
sh deploy/oracle/deploy.sh status ubuntu@your-host
```

A host-side container name locks preparation for the selected Compose project.
A lost workstation connection leaves that lock in place. Status reports
`in-progress-or-interrupted` while the lock exists. Do not delete a lock while
its owner can still run. Managed deployment status takes precedence when a deployment record exists.
Interrupted-operation recovery is separate work.

Use `--project NAME` with both commands for an installation with a different
Compose project name. Use `--directory PATH` to choose private workstation
storage on the filesystem that will hold deployment backup copies. The default
is `~/.local/share/mediamtx-deployments`. The directory must have mode `0700`.
`local` selects the workstation's Docker endpoint for isolated testing.

## Resolve a rejected check

Correct the reported source, secret, service, or host failure, then prepare again.
The host must run Linux ARM64, have at least 1 GiB available memory, and have
sampled CPU use at or below 70 percent. Both databases must pass integrity checks.
Chat storage must remain below its configured database limit.

Preparation measures free bytes and inodes on the workstation, Docker storage,
staging storage, and database storage. Unknown measurements fail. The budget
includes staged files, four times the compressed image layer sizes, future
snapshot and encryption work, database growth, and at least the 10 GiB runtime
reserve. It checks space again after image downloads. Existing recovery files
already consume measured space. Preparation never deletes images, volumes, or
backups to make these checks pass.

Caddy and MediaMTX checks run in separate containers with no network access,
public ports, or live database mounts. Compose and Streaming contract checks
use the selected release configuration. Failed checks leave the current services
running. Failed staging files remain private on the host for inspection. Retention
cleanup runs only after successful deployment. See the
[retention and disk guidance](deployment-retention.md).

## Run the command tests

With a local Docker engine, SOPS, and age available, run:

```sh
npx vitest run scripts/stage-release.test.mjs
```

The suite uses unique Docker projects, real SQLite databases, test-only SOPS
secrets, and controlled GitHub and registry responses. Architecture responses
are controlled so the suite can run on ARM64 and x64 development machines.
The validation containers run on the test machine's native architecture.
The suite never connects to Oracle. Docker unavailability fails the suite.
