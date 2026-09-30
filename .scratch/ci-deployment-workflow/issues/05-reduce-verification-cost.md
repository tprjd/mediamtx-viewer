# 05: Reduce measured setup and Docker costs

Status: resolved
Blocked by: 04

Source: [workflow plan](../spec.md).

Use the separated job timings to optimize the longest work. Measure both elapsed time and total runner time.

- [x] Identify which fixtures, image builds, service waits, and recovery cases account for the long Vitest run.
- [x] Build common fixture images once per compatible job where possible. Reuse immutable inputs while giving each test fresh mutable state.
- [x] Cache Docker build layers with keys or scopes that distinguish architecture and relevant inputs. Verify cold-cache behavior and retain tests after cache hits.
- [x] Avoid compiling SOPS on every run if a pinned, checksum-verified release binary can supply the same required version. Measure the setup change.
- [x] Confirm existing npm caching works before adding more caches. Add browser caching only if measurement justifies its maintenance and invalidation cost.
- [x] Split slow Docker groups across jobs only after confirming unique projects, ports, volumes, and state. Limit concurrency to avoid CPU, memory, and disk contention.
- [x] Review repeated work, including the browser restore scenario and independent restore drill. Retain independent restore verification unless equivalence is demonstrated and documented.
- [x] Keep production build validation and final ARM64 image runtime checks. Remove duplicate build work only if the replacement proves the same required behavior.
- [x] Run complete hosted validation and anonymous image pulls. Record cold and warm setup costs, group durations, and the final critical path.
- [x] Update release and local verification instructions. Report measured improvements and any remaining slow group.

Likely files depend on measurements: Docker fixture helpers, workflow cache configuration, `scripts/release-images.mjs`, and the verification group definitions.

Do not solve contention by weakening production resource checks. Test fixture measurements and explicit rejection cases must remain distinct.


## Comments

Implemented and pushed in 06083f0. Eleven Docker files now run in isolated jobs, with six concurrent groups. Staging uses a common image keyed by input content and Docker endpoint. Real staging tests passed. SOPS setup fell from about 92 seconds to 10.7 seconds in observed hosted jobs; npm cache restoration was confirmed. BuildKit cache uses image and architecture boundaries. Complete cold/warm image validation and critical-path measurements are pending.

Hosted run 36741771175 attempt 1 passed all 17 source groups and both ARM64 image checks, including anonymous digest pulls. Source elapsed time was 22.8 minutes; source runner time was 109.3 minutes. The slowest check remained deploy-release at 20.7 minutes. The cold ARM64 build/test/publish step took about three minutes and saved its BuildKit cache. Final warm-cache and final-source measurements are pending.

The completed deploy-release job has 15 sequential scenarios. Normal activations took 79–84 seconds each. Wrong-version, unhealthy-service, and degraded-Chat recovery cases took 114–125 seconds each; migration-history failure handling took 117 seconds. These cases perform real maintenance, backup, activation, health waits, and recovery. Their assertions and resource checks are retained. Parallel file groups reduce elapsed time but do not reduce total runner time to that elapsed duration.

Run 36749262145 on f7ad79d passed all 17 source groups and provenance aggregation. Source elapsed time was 21.9 minutes and source runner time was 110.2 minutes. The ARM64 build then exposed a SQLite lock while parallel Next.js workers loaded route modules. Commit 1518601 uses private in-memory authentication databases during the build phase; the server retains its configured persistent database. A regression test failed with SQLITE_BUSY before the fix and passed afterward. All 533 fast tests, static checks, and actual local ARM64 image builds and runtime checks passed. Hosted validation of the corrected source is pending.

Warm-cache proof: run 36752925565 attempt 2 restored the exact prior-source BuildKit cache in five seconds and recorded eighteen cached build steps. The build/test/publish step took 78 seconds, versus 134 seconds on attempt 1 and about 180 seconds in the initial cold validation. Both ARM64 images passed runtime checks and anonymous pulls after cache reuse. Whole image-job times were 121 seconds warm and 173 seconds on attempt 1. Validation records remain deployable: false.

Final workflow proof: [run 36752925565](https://github.com/tprjd/mediamtx-viewer/actions/runs/36752925565) on 1518601 passed all 17 source groups, evidence aggregation, native ARM64 builds, layer and private-file inspection, runtime checks, and anonymous digest pulls. Source checks took 22.70 minutes elapsed and 108.87 runner minutes. The complete first attempt took 26.03 minutes from the first job start to the final job finish. An actual rerun of only the static group retained the other 16 successful executions, including all 11 Docker suites; static verification, evidence collection, and warm image validation completed in 3.07 minutes. No production activation occurred. The later 9aa606b commit changes only browser fixtures and receives the six branch checks; its redundant full manual validation was cancelled.
