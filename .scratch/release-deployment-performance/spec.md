# Faster release verification and deployment

Status: ready-for-agent
Date: 2026-10-19
Implementation: Implemented, pushed, and verified. All 26 source verification groups and final ARM64 image validation passed.

This spec records the changes requested and implemented in this conversation. It does not request a second implementation or authorize a new production deployment.

## Problem Statement

Release verification and production deployment take too long. The operator must wait for required checks, then wait again for deployment. Repeating the full Docker suite locally adds more delay.

The last successful release used 19 source verification groups with six concurrent hosted runners. Source verification took 19 minutes 55 seconds and consumed 108.2 runner-minutes. The longest Docker groups took 16–18 minutes because each large file ran its scenarios in sequence. The complete release workflow took about 24 minutes.

The production deployment job then took 13 minutes 36 seconds. It made many Docker requests over SSH, opening a new connection for each client. A measured remote inspection took a median of 471 milliseconds. Starting Node in a remote container took a median of 1,057 milliseconds.

The operator wants shorter elapsed time without removing tests, weakening deployment protections, or treating incomplete verification as success.

## Solution

Distribute the existing Docker scenarios across smaller test files and run up to 12 release verification groups on separate hosted runners. Start the longest groups first. Keep branch verification limited to six concurrent groups.

Reuse an SSH connection within each deployment-controller operation. Keep the existing deployment ownership checks and recovery behavior.

Measure elapsed time and total runner time separately. Parallel tests reduce elapsed time but do not remove the underlying test work. Extra groups can add setup work.

Use complete hosted validation to verify the release changes. Use production preparation, read-only health checks, and an isolated ownership check to verify the transport change without activating a release.

## User Stories

1. As a release operator, I want shorter release verification, so that I can deliver a verified change sooner.
2. As a release operator, I want every required source check to remain mandatory, so that speed does not reduce release confidence.
3. As a maintainer, I want large Docker suites divided by behavior, so that one sequential file does not delay the entire release.
4. As a maintainer, I want every moved scenario and assertion preserved, so that test coverage remains intact.
5. As a release operator, I want the longest groups to start first, so that they do not wait behind short jobs.
6. As a maintainer, I want a fixed concurrency limit, so that verification uses a bounded number of hosted runners.
7. As a developer, I want branch verification to retain its current concurrency limit, so that release tuning does not increase every branch run's concurrency.
8. As a maintainer, I want each scenario to keep its own mutable state, so that parallel verification cannot mix databases, containers, ports, or volumes.
9. As a developer, I want focused local commands to include the relocated tests, so that the documented commands retain their coverage.
10. As a developer, I want the complete Docker suite to run on hosted runners for release verification, so that I do not repeat it locally during implementation.
11. As a release operator, I want browser verification and the independent restore drill retained, so that both checks still provide their existing evidence.
12. As a release operator, I want native ARM64 image inspection and runtime checks retained, so that source success alone cannot qualify an image.
13. As a release operator, I want anonymous pulls of the exact image digests retained, so that a verified release remains retrievable without registry credentials.
14. As a release operator, I want missing, failed, cancelled, or mismatched reports to block release readiness, so that an incomplete run cannot pass.
15. As a release operator, I want each report bound to its source and workflow execution, so that scheduling changes cannot substitute unrelated evidence.
16. As a deployment operator, I want repeated Docker requests to reuse SSH, so that connection setup does not dominate deployment time.
17. As a deployment operator, I want a private connection socket for each operation, so that unrelated operations cannot accidentally share its control path.
18. As a deployment operator, I want ownership checks retained before managed writes, so that connection reuse cannot authorize an abandoned operation.
19. As a deployment operator, I want a competing owner refused, so that two operations cannot change the same installation concurrently.
20. As a deployment operator, I want the lock released when its owning channel closes, so that a shared transport does not keep abandoned ownership alive.
21. As a deployment operator, I want socket cleanup to preserve in-flight commands, so that cleanup cannot interrupt a command that still holds the operation lock.
22. As a deployment operator, I want host readiness, image identity, backup, migration, and health checks retained, so that faster transport does not change deployment acceptance.
23. As an operator, I want before-and-after measurements with their scope stated, so that a preparation benchmark is not presented as a complete deployment benchmark.
24. As an operator, I want validation separated from production activation, so that performance measurements do not cause an unrequested deployment.
25. As a maintainer, I want measured runner consumption reported alongside elapsed time, so that the cost of parallel execution is visible.
26. As an operator, I want the existing production release and Chat health confirmed after measurement, so that I know preparation did not activate another release.

## Implementation Decisions

- Split the four long activation, migration, recovery, and Chat deployment test files into 11 files. Preserve all 48 collected cases and all 26 test declarations with their assertions. Adjust imports and group membership only.
- Keep each Docker file in exactly one required verification group. The complete source verification set now contains 26 groups.
- Keep the existing shared definitions of required commands and Docker test membership. Do not create a second coverage list in the workflow.
- Increase release verification concurrency from six to 12 hosted runners. Keep branch verification at six. Each group runs on its own hosted machine.
- Start candidate recovery, adoption, retention, rollback, and deployment recovery before the remaining release groups. Keep the scheduling list a complete permutation of the required groups.
- Retain sequential scenario execution within each file and the existing fixture isolation. Reuse only the existing immutable fixture inputs and build caches.
- Preserve all eight required check categories: lint, type checks, browser tests, tests, restore verification, production build, Streaming contract validation, and deployment configuration validation.
- Preserve provenance validation, successful-job retention rules, image inspection, runtime checks, and anonymous digest pulls. A cache hit or a scheduling change is not passing evidence.
- Add SSH connection reuse to the private deployment controller with the installed SSH client. Use automatic connection sharing and a 60-second idle lifetime.
- Create a short, private temporary control-socket directory for each controller operation. Distinguish connections by host identity. Do not modify the operator's global SSH configuration or host-key policy.
- Apply connection reuse to controller-managed workflow operations. The SSH adapter passes through normally when no operation socket is configured.
- Remove the operation's socket path after the controller finishes. Do not force-close the shared connection, because a Docker command can outlive its workstation parent.
- Keep the existing host-side ownership token, connection channel, lock, and extra file-descriptor behavior. Connection reuse changes transport cost, not write authorization.
- Keep deployment state transitions, exact image selection, fresh host measurements, verified maintenance backups, migration handling, rollback eligibility, retention rules, and Chat acceptance unchanged.
- Add no dependency, database migration, application API, or release-record schema change.
- Update the maintained release and local-verification instructions to match the new concurrency and test locations.

## Testing Decisions

Test observable behavior at the two existing boundaries: complete hosted release verification and the deployment controller communicating with Docker over SSH. Do not create a new deployment protocol or a separate test framework.

- Compare collected test names before and after the split. Every one of the 48 affected cases must appear exactly once.
- Compare the moved test declarations and assertions with the original source. The 26 declarations must remain unchanged apart from surrounding imports and whitespace.
- Test that release scheduling includes every required group exactly once and puts each selected long group within the first 12 positions.
- Retain the existing verification-aggregation tests. Missing groups, failed checks, changed source identity, wrong commands, and mismatched workflow evidence must still fail.
- Run lint and fast tests locally. Run focused Docker checks locally only where they answer a specific question. Do not repeat the complete local Docker suite.
- Run all 26 source groups through the actual hosted release workflow. Require evidence aggregation, native ARM64 builds, layer inspection, runtime checks, and anonymous digest pulls before declaring validation complete.
- Use validation mode for this task. It may publish temporary test images for anonymous retrieval checks, but it must not create a deployable release or activate production.
- Test the SSH adapter with the real SSH client's effective configuration. With a clean SSH configuration and no operation socket, the adapter must not enable connection sharing. With the socket, automatic sharing and the idle lifetime must be present. Other operator SSH settings remain unchanged.
- Retain the existing test that proves the Docker adapter preserves the deployment owner's extra file descriptor.
- Run the actual ownership program over shared SSH in an isolated temporary container. Accept the current owner, refuse a competing owner, release ownership when the channel closes, and permit a subsequent lock acquisition.
- Remove a control-socket path while a read-only Docker command is in flight. The command must finish successfully.
- Compare repeated read-only inspection and container-execution timings with and without SSH reuse. Use medians and state whether startup samples are excluded.
- Run production preparation before and after the transport change against the same release. Require the same command counts and a prepared result in both runs. Do not activate the staged release.
- Run the controller's actual status workflow. Confirm the current release, service state, lack of an active operation owner, and application and Chat health.
- Remove the temporary benchmark containers after the checks.

The prior tests already cover real Docker lifecycle operations, encrypted backup transfer, SQLite migration and restore behavior, ownership conflicts, interruption, and recovery. The new checks extend those boundaries without replacing them with success-only mocks.

## Out of Scope

- Removing or disabling required tests, assertions, failure scenarios, freshness checks, or release evidence requirements.
- Reducing production health checks or changing test timeouts to produce an earlier success.
- Reusing verification evidence from unrelated source commits or workflow runs.
- Removing the independent restore drill or final ARM64 checks.
- Increasing branch verification concurrency, introducing paid runner services, or running CI on the production VM.
- Changing application behavior, database contents, deployment recovery decisions, or the Streaming contract.
- A version bump, a new release tag, or production activation.
- Timing a complete production redeployment. The deployment measurements cover preparation and individual remote commands.
- Creating implementation tickets or changing earlier completed tickets as part of this documentation request.

## Further Notes

### Measurements

The source baseline is the successful v2.1.6 release. Preparation benchmarks used that same release on the existing production host.

| Measurement | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Required source checks | 19 min 55 sec | 13 min 43 sec | 31.1% less elapsed time; all 26 groups passed. |
| Total source runner time | 108.2 min | 119.7 min | 10.6% more runner time across all source jobs. |
| Production preparation | 133.196 sec | 102.185 sec | 23.3% less elapsed time; identical command counts. |
| Remote Docker inspection | 471 ms median | 109.5 ms warm median | 76.8% lower latency. |
| Remote Node execution in Docker | 1,057 ms median | 292 ms warm median | 72.4% lower latency. |
| Complete production deployment job | 13 min 36 sec | Not rerun | Do not infer a measured end-to-end improvement from preparation. |

Source elapsed time runs from the first source job's start to the last source job's completion. Runner time is the sum of those job durations, including their setup and cleanup. These figures exclude planning, evidence aggregation, and the final ARM64 image job. Parallel execution saved 6 minutes 12 seconds of source verification time but used 11.5 more runner-minutes. The extra test groups add setup work, and job duration also varies between runs. This change improves elapsed time; it does not reduce measured runner consumption.

Inspection used five baseline samples and five shared-connection samples. The shared-connection inspection median excludes the first connection setup. Container execution used three baseline samples and five shared-connection samples; its reported warm median uses the final four samples. Each preparation variant ran once. Runner load, registry latency, and network conditions can change later durations.

The application verification changes are committed through `62c1a8a`. The private deployment-controller change is committed as `da0fcfa`. Both are pushed. The production release remains v2.1.6.

Evidence:

- [Successful v2.1.6 release baseline](https://github.com/tprjd/mediamtx-viewer/actions/runs/39165639288).
- [Production deployment baseline](https://github.com/tprjd/mediamtx-deployment/actions/runs/39167525887).
- [Final hosted validation](https://github.com/tprjd/mediamtx-viewer/actions/runs/39169888537), passed. The downloaded evidence confirms all 26 source groups and eight required check categories, the expected commands and source identity, and successful runtime checks for both exact ARM64 image digests. The final validation record is explicitly non-deployable.
- [Controller status verification](https://github.com/tprjd/mediamtx-deployment/actions/runs/39169351970), passed.
- [Docker guidance on SSH connection reuse](https://docs.docker.com/engine/security/protect-access/#ssh-tips).

An intermediate hosted measurement was cancelled after it exposed a late start for the adoption group. It is not passing release evidence. The final run uses the completed scheduling change.

This spec supplements the earlier [CI and deployment workflow spec](../ci-deployment-workflow/spec.md). It supersedes that work's six-runner release scheduling limit. Its deployment protections and evidence rules remain in force.
