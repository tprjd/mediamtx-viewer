# Implement open registration and channel approval

Type: task
Status: claimed

Implement the [confirmed spec](../spec.md) and [access guide](../../../docs/account-access.md).
Use prototype A for the new flows, within the existing application interface.

## Verification boundaries

Use the confirmed verification plan: registration and migration, channel viewing
requests and decisions, direct media/thumbnail/chat authorization, stored
notifications, and SMTP verification and recovery. Existing playback timing stays
unchanged. Review the implementation against baseline commit `07b1140`.

## Progress

Implementation is present in the existing interface on `codex/open-registration`.
The player bugfix was merged first through PR #1 on 2026-10-04.

Verified: 591 application tests, type checking, lint, production build, SMTP
verification and recovery against the test SMTP server, real Caddy routing, real
Centrifugo connect/refresh authorization, and desktop/mobile browser flows.
Nine focused Chromium checks pass against the production build. Browser checks
cover registration, requests, approval, revocation, persistent mute, and direct
HLS/WHEP/thumbnail rejection.

The initial full Docker run completed with 71 passes and nine failures. Eight
recovery fixture failures came from automatic channel creation leaving fixture
Chat rows linked to an old hard-coded Channel ID. The fixture now uses the
automatic Channel, and all eight affected tests pass on targeted reruns.
The remaining release-retention test failed and then timed out on an isolated
rerun. After removal of 116 orphan staging fixture containers, both retention
tests pass in 465.56 seconds. This result does not establish the cause of the
earlier failures. No retention implementation change was required.

Final review also found that Chat refresh did not check the issuing session.
Connect and refresh now validate the signed session ID and its expiry. Five new
regression checks and a real Centrifugo session-revocation check pass. The viewer
container now receives both internal media origins at runtime.

Version 2.0.0, the changelog, README, and access documentation are prepared.
The first hosted CI run passed all Docker groups. Its browser and restore groups
found three test fixture problems: the broker could not reach the loopback-only
fixture server, automatic channels lacked the expected description, and external
session writes conflicted with registration transactions. These fixtures are fixed.
Six focused browser checks and the existing Linux offline snapshot pass afterward.
Four concurrent registrations pass without external fixture writes.

A dedicated Gmail sender is configured in the encrypted deployment settings.
TLS and SMTP authentication pass from both the workstation and production VM.
The approved test email arrived in the operator's inbox. No second test email was
sent from the VM. Final branch CI and the verified release workflow must pass
before deployment. No production deployment or production database migration has
been performed.

Standards review fixes: separate durable transport completion, independent retry
batches, accurate account-eligibility naming, and notification pagination continuity.
Spec review fix: restrict the public WHIP route to publishing endpoints. RTMP reads
are also rejected. Regression checks cover the access bypasses and retry failures.
