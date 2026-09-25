# Manage Chat on a verified release

## Enable, disable, or inspect Chat

Use a managed installation with a verified current release. Run these commands
from the repository root on the deployment workstation:

```sh
sh deploy/oracle/chat-rollout.sh enable ubuntu@HOST
sh deploy/oracle/chat-rollout.sh health ubuntu@HOST
sh deploy/oracle/chat-rollout.sh disable ubuntu@HOST
```

Use `local` when you run on the Linux Docker host. Add `--project NAME` for a different Compose
project. The equivalent deployment commands are `chat-enable`, `chat-health`,
and `chat-disable` in `deploy/oracle/deploy.sh`.

Enable checks the current release's successful non-capacity verification. The
verification must be less than 24 hours old and match the source and exact images.
To refresh expired evidence, follow [release verification](releases.md#verify-public-images).
The command requires a Linux ARM64 host, at least 1 GiB available memory, and no
more than 70% sampled CPU use. It checks database integrity, the outbox, current
service health, free bytes, and free inodes. It preserves the runtime database
size limit and free-disk minimum.

Enable starts the recorded broker and applies the enabled flag. It succeeds only
when the broker and application Chat checks pass and the outbox is empty. A
failed enable stops the broker and returns Chat to disabled. If cleanup fails,
the command stops the broker and viewer, retains the recorded flag, and requires
recovery. It also uses this outcome if baseline files or runtime settings differ.
Repair the difference before recovery. Stopped services do not change the recorded
Chat flag.

Disable stops the broker to close existing connections and prevent cached tokens
from reconnecting. It then applies the disabled flag and records the effective
state. Later managed activation and eligible rollback preserve this state. The
secret file's default does not override it.

Both changes use the deployment lock and coordinate with database backup and
maintenance. An unresolved operation blocks changes. Inspect the reported failure
before using the [managed recovery commands](../deploy/oracle/README.md).
The commands cancel only the old `chat-capacity-rollback` timer and service.
They preserve unrelated timers and active recovery markers.

Health reports `disabled`, `healthy`, `degraded`, or `unavailable`. It returns a
failure for degraded or unavailable Chat. HTTP 200 from the core application does
not prove that Chat is healthy. See [Chat health](chat-operations.md#health)
for runtime fault details.

Schedule Chat changes and deployment as planned maintenance. Recreating the
viewer can interrupt viewing. These commands do not promise uninterrupted viewing.

## Capacity remains unverified

Routine managed deployment and explicit Chat enable do not require a live load
test, synthetic production participants, or the 700,000-message storage benchmark.
Reports state `capacity: "unverified"`. They do not fabricate a passing capacity
report.

The owner accepted a partial capacity run on 16 September 2026 for that deployment
only. The full capacity target remains unverified. Optional tools in
`scripts/chat-capacity/` remain available for a separately approved measurement.
The old timed `trial` command is no longer part of the operational procedure.
Do not use a short run, fixture playback, or missing measurements as a capacity pass.

Normal release verification still runs lint, type checks, unit and integration
tests, browser tests, the independent restore drill, a production build, Streaming
contract validation, both Compose Chat states, and authenticated WebSocket proxy
tests. The realtime integration tests use the pinned Centrifugo image. Follow
[local test troubleshooting](chat-operations.md#troubleshoot-local-chat-tests)
if Docker is unavailable.
