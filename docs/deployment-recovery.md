# Recover an interrupted managed deployment

These commands recover managed deployment and adoption attempts. They never
restore databases automatically. The old upload and VM-build command is retired.

## Inspect the attempt

From a fresh workstation connection, run:

```sh
sh deploy/oracle/deploy.sh status TARGET --project mediamtx-viewer
```

Status identifies the original attempt, selected and previous releases, phase,
backup set, workstation acknowledgement, observed migration records, and container
identities. It returns a nonzero status for an unresolved or failed attempt.
A missing or unreadable database has a `null` migration observation.

If `owner` is `active`, wait for that operation. Recovery cannot take its host
lock. A connection holds this lock without a time limit. A slow operation is not
an abandoned operation. If the connection is stuck, close its workstation process
and SSH connection before you inspect status again.

If `owner` is `abandoned`, inspect both database histories and the release choices.
Keep public access in maintenance until recovery passes acceptance. Do not remove
the deployment tool container, maintenance marker, backup lock, staging volume,
images, or private source directories to bypass recovery.

The `protection` record lists the staging volume, source directories, image
references, and backup sets that cleanup must retain. It contains no secret
values. While `unresolved` is true, retain the entire staging volume, including
partial staging and private recovery records. Scheduled backups use the same
backup lock and cannot remove deployment backup sets.

## Select recovery

To use the previous release without database replacement, run:

```sh
sh deploy/oracle/deploy.sh recover TARGET --project mediamtx-viewer \
  --release previous --restore none
```

For an interruption during preparation, this cancels preparation and verifies the
previous release. It does not repeat staging. For an interruption after migrations,
recovery checks database compatibility before it starts the selected release.
It does not run migrations. If the candidate migrations completed, you can select
`--release candidate --restore none`.

If backup transfer was interrupted, provide the backup key and a private
workstation directory. Recovery copies missing encrypted files from the original
host set and verifies the complete set. It does not replace existing workstation
files. If a local copy is damaged, select a new private directory with `--directory`.
An old acknowledgement cannot authorize a different attempt or backup set.

If database replacement is necessary, select `auth`, `chat`, or `both` explicitly.
Replacement can discard later data. For example:

```sh
sh deploy/oracle/deploy.sh recover TARGET --project mediamtx-viewer \
  --release previous --restore auth --confirm discard-later-data
```

Recovery stops writers, verifies the release files and database compatibility,
then checks application and proxy health before it opens public access. It retains
replaced database files. A failed recovery keeps its evidence and maintenance.
After successful activation with a lost client result, select the accepted release
with `--restore none`. Recovery checks that release without repeating migrations.

## Inspect a restarted host

Run status before you start application containers manually. Managed application
services and migration containers have no automatic restart policy. Application
startup runs `server.js` directly and cannot run a migration. The static maintenance
proxy restarts with Docker until the attempt completes and removes it.

Recover through the operator command. Do not run the legacy deployment command,
`docker compose up`, startup migration scripts, or a scheduled restore to bypass
an unresolved attempt. Before any manual removal of stale files, establish all of
the following: the connection owner is absent, migration processes are stopped,
the original attempt owns the files, both database histories are known, and the
selected release passes recovery acceptance. A stale lock alone proves none of
these facts. The recovery command releases only its own operation after acceptance.

## Interrupted adoption

Use `recover TARGET --release previous --restore none` for an interrupted
[adoption](adopt-installation.md). Before baseline publication, recovery resumes
capture under the original owner. After publication, it verifies the recorded
baseline. It does not invent GitHub evidence or replace databases.
