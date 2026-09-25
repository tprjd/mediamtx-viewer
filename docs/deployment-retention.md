# Deployment retention

After an accepted managed deployment or recovery, cleanup keeps two releases:
current and previous successful. Each includes its exact local images, Compose
configuration, mounted files, and private secrets. An undeployed build does not
replace either release. Chat enable and disable do not rotate release history.

Cleanup keeps the two newest complete, verified deployment backup sets on the VM
and workstation. A set contains both encrypted databases and its authenticated
manifest. Two sets from the same day count separately. A host set does not qualify
until the workstation has verified and acknowledged its copy.

Before rotation, cleanup verifies checksums, authenticated decryption, SQLite
integrity, and recorded migrations. A changed encryption key, damaged file, or
incomplete transfer cannot displace a usable set. Cleanup preserves unreadable
sets and directories without acknowledged receipts and reports why they remain.
Keep the keys needed to read retained sets outside backup storage.

Scheduled backups retain their separate seven-day policy. Deployment cleanup
never changes that directory or Chat message retention. It does not remove
application volumes or retained database files from an explicit restore.

## Protected files and temporary space

An unresolved deployment protects its referenced releases, images, configuration,
secrets, and backups. These files can exceed the usual two-release and two-set
limits. If a record is unreadable or its protection metadata is incomplete,
cleanup stops rather than guessing what it can remove.

Allow additional space for a staged candidate, an in-progress backup, snapshot
and verification copies, and database growth. Preparation checks bytes and inodes
on both machines. Backup checks them again before transfer. Activation checks
host storage and the workstation reserve again. Existing protected files count
as used space. A failed space check stops progress without deleting recovery
files to make room.

Cleanup starts only after health acceptance and maintenance completion. A failed
deployment does not rotate successful history, including when automatic rollback
succeeds. A later successful deployment or explicit recovery can run cleanup.
A cleanup failure does not roll back an accepted application. Its report lists
remaining work.

## Retry cleanup after reconnecting

Use the same target, project, and private workstation directory as deployment:

```sh
sh deploy/oracle/deploy.sh cleanup TARGET \
  --directory "$HOME/.local/share/mediamtx-deployments"
```

Supply `AUTH_BACKUP_KEY` through the same private environment used for deployment.
The command takes the deployment lock, checks the accepted application, and reads
fresh host receipts before it removes workstation copies. An active or unresolved
host operation blocks this command. Run explicit recovery first when required.
Use `status TARGET` to inspect that attempt.

The JSON report distinguishes completed cleanup from protected or pending files.
`cleanup` exits nonzero when work remains or protection exceeds normal limits.
Retry after restoring the required key or repairing the reported condition.
The private host file `/stage/retention-status.json` records the last result.

Local image removal uses only recorded immutable digests or image IDs. It
preserves shared identities, does not force removal, and never runs Docker prune.
Mutable image tags without a recorded identity remain for inspection.

Registry deletion is disabled. The report lists protected digests, but one host's
history is not a complete inventory of registry consumers. Keep registry images
when deployment references cannot be established. Publication date or the newest
published tag is not a safe deletion rule. This does not change registry visibility
or the release workflow's pricing assumptions.

## Verification

Run the short filesystem and real encrypted-set checks:

```sh
npx vitest run scripts/deployment-retention.test.mjs
```

Run the longer command tests with local Docker, SOPS, and age:

```sh
npx vitest run scripts/deployment-retention-docker.test.mjs
```

The Docker tests use isolated projects and real deployment commands. They do not
connect to Oracle. Also run the existing deployment, recovery, and backup suites
before release.

The [adopted installation](adopt-installation.md) is the previous release for
the first successful managed deployment. Its captured files and exact images
receive the same retention protection without a GitHub verification claim.
