# Spec: Verified releases and recoverable deployment

Status: complete

## Problem Statement

Deploying the application requires the operator to copy a local working directory
to the Oracle VM and build there. The source can include uncommitted changes.
The deployment changes live source, configuration, and secrets before the build
finishes. A failure can leave the running services and their files at different
versions.

The operator has no complete deployment rollback procedure. The script does not
create a deployment backup or prevent concurrent deployments. Database
migrations run at application startup and commit individually. A failed startup
can therefore leave some migrations applied. Restoring the old application does
not necessarily restore a working system.

Every deployment also disables Chat. Restoring Chat requires a separate procedure
with a live load test and a synthetic storage benchmark. The owner has decided
that these benchmarks must no longer be mandatory deployment requirements.
Ordinary verification and runtime safeguards must remain.

The operator wants reliable recovery first, then fewer manual steps. The solution
must keep the current Oracle VM, avoid additional recurring costs, and permit
brief interruptions during planned maintenance.

## Solution

Pushing an annotated release tag starts GitHub Actions verification and builds
the viewer and thumbnailer images for Linux ARM64. Successful builds publish
public images to GitHub Container Registry. The images contain no deployment
secrets or private configuration. Standard GitHub runners for this public
repository and the registry's current pricing meet the cost constraint.

The operator runs one command from the workstation to deploy a selected verified
release to Oracle. The command stages exact images and configuration before
maintenance. It then stops application writers, creates a verified encrypted
backup of authentication and Chat, and copies the complete backup to the
workstation. Only after verification of that copy may it migrate databases and
activate the release.

Deployment preserves the existing Chat enabled or disabled state. It checks the
release identity, service health, and the expected Chat state before restoring
normal access. It retains normal tests, source verification, database integrity
checks, and available-disk checks. It removes mandatory capacity benchmarks.

If activation fails, deployment can restore the previous application and
configuration only when no new database migration was applied and database state
is known. It never restores a database automatically. A failure after a migration,
an uncertain database state, or a failed rollback leaves the system in
maintenance with instructions for explicit recovery.

Keep the current release, one previous successful release, and two deployment
backup sets. Keep encrypted copies of those backup sets on the VM and workstation.
An unresolved failure protects its recovery files from cleanup.

## User Stories

1. As an operator, I want to select a release tag, so that I know which committed source I am deploying.
2. As an operator, I want local uncommitted changes excluded from deployment, so that a working directory cannot change a published release.
3. As a maintainer, I want a pushed release tag to start verification, so that every release follows the same checks.
4. As a maintainer, I want failed checks to prevent release readiness, so that an unverified build cannot reach production.
5. As an operator, I want GitHub to build Linux ARM64 images, so that the Oracle VM does not spend resources building the application.
6. As an operator, I want both viewer and thumbnailer images built from the selected commit, so that the release is internally consistent.
7. As an operator, I want standard free GitHub runners, so that deployment does not add a recurring service cost.
8. As an operator, I want public container images, so that the VM can download them without registry credentials.
9. As an operator, I want secrets excluded from image layers and build output, so that public distribution does not expose private configuration.
10. As an operator, I want verification linked to exact image digests, so that a mutable image tag cannot substitute another build.
11. As an operator, I want manual control over deployment timing, so that I can choose a maintenance period.
12. As an operator, I want one deployment command, so that I do not need to assemble the normal deployment sequence by hand.
13. As an operator, I want validation before maintenance, so that a missing image or invalid configuration does not interrupt the running release.
14. As an operator, I want disk-space checks on the VM and workstation, so that staging and backup do not exhaust storage.
15. As an operator, I want concurrent deployments rejected, so that two commands cannot mix releases or configuration.
16. As an operator, I want unchanged services to stay running where possible, so that deployment causes only necessary interruptions.
17. As a viewer, I want a clear maintenance response, so that I can distinguish planned work from an unexplained application error.
18. As an administrator, I want account changes blocked during the deployment backup and activation, so that accepted changes do not cross an uncertain recovery boundary.
19. As a Chat participant, I want Chat writes stopped during deployment maintenance, so that a message is not reported as accepted by a stopped service.
20. As an operator, I want background writers stopped before backup, so that blocking browser traffic is not mistaken for a stable database state.
21. As an operator, I want both databases backed up before migration, so that manual recovery has a complete deployment recovery point.
22. As an operator, I want backup encryption and integrity verified, so that a corrupt or unreadable backup stops deployment.
23. As an operator, I want an encrypted backup copy on my workstation, so that loss of the VM does not also remove every deployment backup.
24. As an operator, I want a failed backup transfer to prevent activation, so that deployment cannot proceed with an incomplete recovery set.
25. As an operator, I want daily backup rotation kept separate from deployment retention, so that a scheduled job cannot remove a protected recovery set.
26. As an operator, I want migrations run as a controlled deployment step, so that container restart loops cannot continue changing databases after failure.
27. As an operator, I want applied migrations checked in both databases, so that partial success is detected even when a later migration fails.
28. As an operator, I want a failed release rolled back automatically when eligible, so that a failure without database changes needs less manual repair.
29. As an operator, I want automatic rollback blocked after any newly applied migration, so that older code is not started against an unverified database state.
30. As an operator, I want an unreadable migration state treated as uncertain, so that recovery never guesses that rollback is safe.
31. As an operator, I want database restore to require an explicit action, so that rollback cannot silently discard data.
32. As an operator, I want rollback to restore images, configuration, mounted files, and Chat state together, so that the previous release is a usable recovery target.
33. As an operator, I want a failed rollback to keep maintenance active, so that users do not reach a partly recovered application.
34. As an operator, I want deployment state to survive a lost connection, so that I can inspect and recover the same attempt after reconnecting.
35. As an operator, I want interrupted deployment detected after a host restart, so that startup does not silently bypass recovery checks.
36. As an operator, I want repeat commands to recognize completed phases, so that retries do not repeat migrations or overwrite recovery evidence.
37. As an operator, I want the current Chat state preserved, so that a routine deployment does not disable an enabled feature.
38. As an operator, I want disabled Chat to remain disabled, so that deployment does not enable it without an explicit choice.
39. As an operator, I want enabled Chat checked for actual health, so that a successful core HTTP response cannot hide a Chat failure.
40. As an operator, I want deployments to omit mandatory load and storage benchmarks, so that routine releases do not require synthetic participants or messages.
41. As an operator, I want normal tests and runtime storage limits retained, so that removing benchmarks does not remove unrelated safeguards.
42. As an operator, I want explicit Chat enable and disable operations to keep working, so that I can manage Chat independently of a release.
43. As an operator, I want the reported version to match the selected release, so that I can verify which application is running.
44. As an operator, I want two retained releases with their exact images and configuration, so that a previous successful release remains available without a rebuild.
45. As an operator, I want two complete deployment backup sets on each machine, so that retention is small and predictable.
46. As an operator, I want unresolved recovery files protected from cleanup, so that a failure cannot delete the evidence needed to repair it.
47. As an operator, I want insufficient space to stop deployment, so that cleanup does not sacrifice the only rollback image or backup.
48. As an operator, I want a concise result with the failed phase and next recovery action, so that I can act without reconstructing shell output.
49. As an operator, I want operational output to exclude secrets and private application data, so that logs can support diagnosis safely.
50. As an operator, I want the existing installation adopted as a recoverable baseline, so that the first deployment through the new process has a previous state.
51. As a maintainer, I want failure tests through the deployment command, so that tests prove operator-visible recovery behavior.
52. As a maintainer, I want deployment tests isolated from production, so that verification cannot alter real accounts, Channels, or Chat messages.

## Implementation Decisions

1. **Release identity and readiness.** Keep the existing annotated release-tag and application-version conventions. A release identifies one commit, the application version, both application image digests, and successful verification evidence. Reject a mismatch between the tag version and application version. A moved tag, mismatched commit, missing image, wrong architecture, or incomplete verification cannot become a deployable release. The operator selects a release tag, but activation uses resolved immutable digests.

2. **GitHub builds.** Add a release-tag workflow using standard GitHub-hosted Linux ARM64 runners. Build both application images from the tagged checkout. Run the existing non-capacity verification sequence with test-only configuration and isolated services. A failed job must not publish a successful release record. A partly uploaded image is not sufficient evidence of release readiness. Normal deployment does not build on the Oracle VM.

3. **Public images and private operations.** Publish application images to GitHub Container Registry with public visibility. Keep workstation SSH access, SOPS decryption, backup keys, production secrets, and private configuration outside CI and image build contexts. Exclude encrypted deployment-secret bundles and operator notes from public images as well. Use the workflow's limited package-publishing permissions. Image download on Oracle must work without registry credentials.

4. **Verification evidence.** Preserve lint, type checking, unit and integration tests, browser tests, the independent restore drill, production build checks, Streaming contract validation, Compose validation, and authenticated proxy checks. Bind the evidence to the tagged source and the exact built images. Include all inputs for both images and deployment configuration in source verification. The current fingerprint omits some relevant inputs and must not be assumed complete.

5. **Release evidence and deployment freshness.** New format-2 release records retain successful test evidence for their exact committed source, annotated tag object, source fingerprint, and image digests. Elapsed time alone does not require another source test run. Format-1 records retain their 24-hour expiry; a refresh preserves the format. Creating or refreshing a record requires recent source checks. Reject unsupported formats, incomplete evidence, failed or inaccessible workflow records, moved identities, and draft or unpublished releases. Operators revoke a release for future selection by making it a draft or removing its publication. Each deployment must check current image availability and identity, configuration, host resources, storage, database state, verified backup, and candidate runtime health. Durable evidence does not prove current vulnerability status. Rollback uses the retained successful deployment record, database compatibility, and fresh runtime health checks. Revocation does not stop a running deployment or remove retained recovery evidence. Rollback must not require rebuilding an old release or manufacturing a new capacity report.

6. **Operator interface.** Extend the deployment command to select a target host and release tag. Provide a status operation and an explicit recovery operation for interrupted attempts. Reports identify the attempt, selected release, previous release, backup set, current phase, result, and next action. Use nonzero exit status for a rejected or failed deployment, including a failure followed by successful rollback. A successful rollback must be distinguishable from a successful forward deployment.

7. **Deployment coordination.** Use one host-side owner for activation and recovery, protected by an exclusive deployment lock. Record phase transitions durably before actions that can change live state. A workstation disconnect must not lose the record or permit an overlapping attempt. The host cannot migrate until the workstation has acknowledged verification of its backup copy. If progress cannot be established after a disconnect or restart, stop in maintenance and require explicit recovery. Do not infer success from a disconnected client.

8. **Staging and preflight.** Stage the selected release separately from live files. Download and verify its images before maintenance. Validate the Compose model, required secret files, Caddy configuration, MediaMTX syntax, and the Streaming contract without replacing active configuration. Check host architecture, available memory, sampled CPU use, service state, database integrity, and disk space. Preserve the existing non-capacity host limits. Reject an unavailable or inconsistent previous release rather than inventing a healthy baseline.

9. **Storage budget.** Replace the synthetic storage benchmark requirement with direct free-space and required-space checks. Account for staged images, configuration, database snapshots, encrypted sets, workstation copies, database growth, and existing protected recovery files. Check both bytes and inodes where applicable. Preserve the application runtime storage limits. Check again before backup and activation because an earlier measurement can become stale. A failed measurement stops progress.

10. **Maintenance boundary.** Stage and verify before entering maintenance. Serve a static maintenance response that does not depend on the viewer process. Stop or drain public application requests, persistent connections that can submit writes, and background database writers before the backup boundary. Coordinate scheduled backups and restores with deployment. Maintenance permits controlled migration and validation work, but does not reopen user writes until acceptance completes. Do not promise uninterrupted viewing or publishing.

11. **Pre-change backup.** Reuse the existing encrypted two-database backup format, authenticated manifest, checksum verification, and restore validation. Create the deployment snapshots from a stable pair of databases. Avoid changing live data as a side effect of deployment backup creation; apply any required expiry cleanup to snapshots. Preserve existing Chat retention rules when a backup is restored. Run backup tools with an explicit command that does not invoke application startup migrations.

12. **Workstation verification.** Transfer the complete encrypted set and its manifest to private workstation storage. Verify checksums, authenticated decryption, database integrity, and migration records before authorizing activation. Temporary plaintext used for verification must have restricted permissions and be removed after verification. Keep encryption keys separate from backup sets. Missing keys, a damaged set, an interrupted transfer, or failed verification prevents migration and activation.

13. **Separate retention lifecycles.** Keep deployment backup sets separate from the existing seven-day scheduled backup rotation. The decision to retain two deployment sets does not change scheduled backup retention or Chat message retention. Neither job may remove files owned by the other lifecycle. A protected deployment backup remains available through failed attempts and operator recovery.

14. **Controlled migrations.** Run authentication and Chat migrations as explicit deployment phases before starting the candidate application normally. Suppress implicit migration retries during activation and rollback. A failed Chat migration must fail deployment even though ordinary application startup currently permits that failure. Record actual applied migrations in both databases before the attempt, then inspect both databases after success or failure. Stop all migration processes before making that comparison.

15. **Rollback eligibility.** Automatic rollback requires known database state and no new migration applied in either database. A partially successful migration sequence blocks automatic rollback. Missing records, altered migration history, unreadable databases, or an uncertain result also block it. The absence of new migration files is not proof that no migration ran. Existing migration history must not be rewritten as part of this feature.

16. **Automatic recovery.** If failure occurs before migration or activation changes, restore access to the unchanged previous release after checking its health. If activation fails and rollback is eligible, restore the exact previous images, configuration, mounted files, and Chat state. Recheck that release before ending maintenance. Never replace either database during automatic recovery. If migration state or recovery is uncertain, keep writers stopped and report the required explicit action.

17. **Manual recovery.** Recovery exposes the failed phase, observed migration changes, available releases, and verified backup locations. Require an explicit operator action to restore a database or select a different recovery path. Reuse the existing independent database restore protections and compatibility checks. The procedure must state that a database restore can discard later data. It must work from maintenance without requiring normal public application access. Database replacement is never an implicit consequence of retrying deployment.

18. **Exact runtime state.** Retain resolved image identities for every managed service, the resolved deployment model, mounted configuration and scripts, required secrets, and the effective Chat flag. Preserve the existing Compose project and persistent volumes. A changed directory or symbolic link must not be treated as proof that a running container uses the new mounted files. Reload or recreate affected services deliberately and verify the result. Do not delete application volumes during activation, recovery, or cleanup.

19. **Chat state.** Read and record the effective Chat state from the current deployment rather than trusting a stale secret-file default. Carry it through activation and eligible rollback. Enabled Chat requires a healthy broker and healthy application Chat status before completion. Disabled Chat remains disabled and must not reopen broker connections. An enabled-Chat failure fails deployment; it must not silently become a successful deployment with Chat disabled.

20. **Chat policy change.** Remove the mandatory live load test, synthetic storage benchmark, and capacity-report dependency from standard deployment and explicit Chat enable. Keep the independent checks and runtime storage limits. Keep explicit Chat disable and health operations. Optional capacity tools may remain available, but their reports and trial timers must not control normal deployment. Resolve any old active trial timer during adoption so that it cannot disable Chat after a successful deployment. Do not mark the unverified capacity target as passed.

21. **Acceptance checks.** Check the expected application version and image identity, core health, required service health, database integrity, expected Chat state, and public proxy behavior. When Chat is enabled, require healthy Chat and a drained delivery queue within a bounded wait. Core HTTP success alone is insufficient. Reuse authenticated proxy and browser checks with fixtures for release verification; deployment must not create synthetic production accounts or Chat messages. Do not require a live Channel or a capacity trial for a routine deployment.

22. **Retention.** After successful activation, retain two completed deployment releases: current and previous successful. Retain their exact images and configuration. Retain the two newest complete deployment backup sets on both VM and workstation. A candidate can temporarily require a third release during staging. Unresolved failures can temporarily protect additional files. Cleanup occurs only when ownership and recovery protection are known, and never to make a failing preflight pass by deleting the only rollback state. Registry cleanup must preserve image digests referenced by retained deployments; publishing a newer image must not evict a running or rollback image.

23. **Adoption of the existing installation.** Before the first managed activation, capture and verify the current installation as the previous runtime state, including local image identities, mounted files, live Chat state, and persistent-volume ownership. Mark it as an adopted baseline without claiming that it passed new CI checks. Keep existing operational jobs pointed at the active deployment. If the baseline cannot be made recoverable, reject activation with a repair action. Fresh VM provisioning is outside this feature.

24. **Secrets and external changes.** Continue workstation SOPS decryption and restricted host secret storage. Stage changed secrets before activation and retain the previous release's required secret material privately. Do not print resolved secret-bearing configuration. Automatic recovery restores local deployment state only; it cannot undo externally revoked credentials or other external changes. Reject an automatically managed change that cannot preserve a usable recovery state. Credential rotation and provisioning remain explicit operations outside this deployment improvement.

25. **Documentation and versioning.** Update release, deployment, Chat rollout, and backup guidance with the implemented behavior. Remove obsolete mandatory-capacity instructions from active procedures while preserving the historical fact that capacity remains unverified. Keep the application version derived from package metadata and visible in the header and health response. This planning work does not change versions. Any later release follows the existing release policy.

## Testing Decisions

- Use one primary new test boundary: the operator's deployment, status, and recovery commands against an isolated Docker host. Test the same orchestration used for production. Keep real SQLite files, encryption, migration execution, container lifecycle, and HTTP observations. Control failures at external boundaries rather than asserting private helper calls or shell command text.
- Reuse the existing Vitest and Playwright tools. Add a disposable deployment environment with unique project names, temporary directories, test-only secrets, and fixture services. It must not connect to Oracle production, send Discord notifications, or create real accounts and messages. Tests that require Docker must fail clearly when Docker is unavailable; skipped integration work is not a passing release.
- Test release selection and verification through the public command interface. Use a controlled registry or download fixture for rejection scenarios. Prove that wrong digests, wrong architecture, moved tags, mismatched versions, incomplete reports, and expired format-1 evidence stop before maintenance. Valid format-2 evidence still requires fresh deployment checks.
- Extend the existing backup command tests for deployment backup creation, encrypted transfer verification, snapshot consistency, expiry handling, and separate retention. Use actual databases and encrypted files. Reuse the authenticated-manifest and independent-restore tests rather than introducing a parallel backup format.
- Reuse the existing browser restore drill and Chat restore integration tests for recovery behavior. Add only the deployment scenarios they do not cover. The independent Chat restore promise remains distinct from planned deployment interruption.
- Use existing Compose validation, MediaMTX validation, Streaming contract tests, and authenticated proxy tests as prior art. Verify both Chat states. Keep the pinned broker behavior covered and assert Chat health separately from core HTTP health.
- Add a small real GitHub ARM64 workflow acceptance run during implementation. Verify that both images start on ARM64, that public anonymous pulls work, and that the release record identifies their tested digests. Inspect image layers and public output for known fixture secrets. A locally valid workflow file is not proof that the hosted workflow works.
- Measure observable results: exit status, deployment status output, public maintenance and health responses, running image identities, database contents, applied migration records, and retained recovery files. Do not test internal function layout, private phase-storage representation, or exact log wording.

The command-level suite must cover these acceptance cases:

| Scenario | Required observation |
| --- | --- |
| Release download, verification, or configuration validation fails | Previous release keeps running; no active configuration or database changes. |
| VM or workstation lacks space | Deployment stops before activation; protected images and backups remain. |
| A second deployment starts | It is rejected without modifying the active attempt. |
| Maintenance begins | Public user writes and background writers stop before the deployment snapshot boundary. |
| Backup is corrupt, key is wrong, or transfer is interrupted | No migrations run; previous service resumes only after a valid health check. |
| Normal deployment with Chat enabled | Selected images run, expected version appears, Chat is healthy, and maintenance ends. |
| Normal deployment with Chat disabled | Selected images run and Chat remains disabled. |
| Activation fails without new applied migrations | Previous images, configuration, and Chat state return; database data is not restored or replaced. |
| A migration fails before committing its first change | Inspect real records in both databases; rollback is allowed only if state is unchanged and known. |
| An earlier migration commits and a later migration fails | Maintenance remains; no automatic old-application start or database restore occurs. |
| Authentication migration commits and Chat migration fails | The authentication change is detected; automatic rollback remains blocked. |
| Migration records cannot be read | Maintenance remains and status reports uncertainty. |
| Core health passes but enabled Chat is degraded | Deployment fails rather than reporting successful activation. |
| Eligible rollback itself fails | Maintenance remains and recovery evidence stays available. |
| Client disconnects before backup acknowledgement | Migration cannot start without verified workstation-copy acknowledgement. |
| Client disconnects or host restarts during activation | A new command finds the same attempt and a safe recovery state; it cannot start an overlapping deployment. |
| Operator retries a completed or failed attempt | Completed migration effects are not repeated, and recovery evidence is not overwritten. |
| Explicit database restore is selected | The existing confirmation, integrity, compatibility, and retention protections apply; no unrelated database is replaced. |
| Daily backup and deployment overlap | Coordination prevents inconsistent snapshots and deletion of protected deployment sets. |
| Successful deployment triggers retention | Only current and previous successful releases and two complete deployment sets remain, except explicitly protected unresolved files. |
| A newer build exists but is not deployed | It does not evict images needed by the current deployment or its rollback target. |
| Existing installation is adopted | Original volumes, runtime configuration, and effective Chat state are preserved as a recoverable baseline. |
| No capacity reports exist | Valid standard deployment and explicit Chat enable can succeed with the retained non-capacity checks. |

## Out of Scope

- Uninterrupted or multi-host deployment, blue-green operation, clustering, and a new database engine.
- Automatic production deployment on a push, paid GitHub runners, a new paid service, or a change of hosting provider.
- New Oracle infrastructure, fresh-install provisioning, DNS migration, firewall redesign, kernel tuning changes, and external credential rotation.
- Automatic database restore, reverse migrations, or a general proof that older application versions support newer database schemas.
- Changes to the Streaming contract, Playback run recovery, transport selection, managed OBS profiles, or viewer identity.
- Changes to account grants, Channel ownership, Chat moderation rules, message retention, or the existing seven-day scheduled backup policy.
- Mandatory live capacity trials, synthetic storage benchmarks, production test participants, and certification of the unverified Chat capacity target.
- A new deployment dashboard, a new test runner, or a second backup encryption format.
- Running a production deployment, changing GitHub settings, publishing images, or cutting a release as part of writing this spec.

## Further Notes

- The owner accepted this design through the deployment interview. The later GitHub build choice replaces the earlier suggestion to build on the Oracle VM. The retention decision is two releases total, not two previous releases in addition to the current release.
- The owner confirmed the deployment-command test boundary against an isolated Docker host, with real SQLite backups, migrations, and controlled failures.
- Canonical decisions are recorded in the [deployment guide](../../deploy/oracle/README.md#deployment-improvement-decisions) and [Chat policy notes](../../docs/chat-rollout.md#planned-policy-change). These notes describe planned behavior. The current scripts still implement the old procedure.
- Read the [domain glossary](../../CONTEXT.md), [Chat operations](../../docs/chat-operations.md), [release policy](../../docs/releases.md), and [local tracker conventions](../../docs/agents/issue-tracker.md) before implementation. No new domain term or separate ADR is required for this spec.
- Existing test references include [backup command tests](../../scripts/database-backups.test.mjs), [Chat restore integration tests](../../lib/chat-restore.integration.test.ts), the [browser restore drill](../../tests/e2e/chat.spec.ts), [deployment validation](../../scripts/validate-chat-deployment.mjs), and [Streaming contract tests](../../scripts/validate-streaming-contract.test.mjs).
- The repository is [public on GitHub](https://github.com/tprjd/mediamtx-viewer). [GitHub billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions) make standard hosted runners free for public repositories. The [runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) lists standard Linux ARM64 runners. [Container Registry storage and bandwidth are currently free](https://docs.github.com/en/billing/concepts/product-billing/github-packages). Recheck these facts if pricing or repository visibility changes.
- There is no current deployment workflow in the repository. This spec therefore requires verification of hosted execution during implementation, not a claim that CI already works.
- Create implementation tickets from this spec in the local tracker. Keep each ticket self-contained and identify its blockers. This specification does not create tickets or authorize a live release by itself.

## Completion record, 2026-09-30

All nine implementation issues are resolved. The selected-tag deployment command is the documented default. The previous working-directory upload and VM-build entry point is retired.

Full hosted acceptance passed on `1518601` in [run 36752925565](https://github.com/tprjd/mediamtx-viewer/actions/runs/36752925565), including both ARM64 images and anonymous pulls. The final browser-fixture-only change `9aa606b` passed [branch verification](https://github.com/tprjd/mediamtx-viewer/actions/runs/36756829244). See the [CI workflow spec](../ci-deployment-workflow/spec.md) for the final verification design and measurements.

These results establish implementation acceptance in isolated environments. They do not establish production activation. Further validation is deferred at the user's request. This documentation update does not cut a release or start validation.
