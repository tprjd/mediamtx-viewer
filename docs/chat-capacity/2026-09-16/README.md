# Chat rollout evidence, 16 September 2026

The owner accepted the partial capacity run and declined further load messages. This is an operational exception to the original capacity target. The measured capacity report remains `passed: false`. The standard enable command still requires all original capacity thresholds.

## Measured load

The run used the live `/watch/live` Channel, H.264 playback in Chromium, and 100 authenticated temporary accounts. It accepted 2,009 messages before the operator stopped it. The playback observations cover about 204 seconds. The complete 15-minute target and reconnect test were not completed.

| Measurement | Observed | Original requirement |
| --- | ---: | ---: |
| Concurrent load connections | 100 | 100 |
| Accepted messages | 2,009 | 9,000 over 15 minutes |
| Submission p95 | 1,047 ms | At most 500 ms |
| Delivery p95 | 1,043 ms | At most 1,000 ms |
| 100-message history p95 | 1,203 ms | At most 1,000 ms |
| Observed delivery receipts | 200,400 | Complete delivery to every connection |
| Playback observations | 205, no interruptions or recovery | Full-run continuity |
| Status request p95 | 956 ms | At most 1,000 ms |
| Maximum status age | 1,095 ms | At most 5,000 ms |
| Maximum heartbeat gap | 20,145 ms | At most 22,000 ms |
| Peak sampled host CPU | 96.3% | Healthy steady state after load |
| Minimum available memory | 3.22 GiB | At least 1 GiB |

The [unaltered partial report](partial-load.json) includes samples and failed gates. It records 35 rejected requests, including requests made during rollback. Two POST failures before rollback match proxy connection-reset logs. Its zero duration and expected-delivery fields indicate that the driver did not reach its end-of-load calculation. They do not indicate an empty run. Reconnect measurements and the driver's final steady-state phase are absent.

Manual rollback succeeded. The driver's concurrent rollback attempt reported failure while the manual command recreated the viewer. Five accepted messages remained in the durable outbox after rollback. Restart verification must drain these messages without deleting them.

## Corrected deployment faults

The real deployment checks found and corrected these faults:

- Obsolete source files remained on the VM. Deployment now removes obsolete files only inside application source directories. The gate compares local, deployed, and image source hashes.
- The authentication proxy forwarded WebSocket upgrade headers to an HTTP route. It now removes those headers only from the authentication subrequest. A real Caddy test verifies active and inactive sessions, path rewriting, and cookie removal.
- Caddy retained idle viewer connections longer than Next.js's five-second timeout. All viewer proxy transports now use four seconds. A regression test reproduces a failed POST after idle connection reuse and passes with the fix. [Caddy documents this failure mode](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#the-http-transport).
- A disabled viewer could not drain pending deliveries before the trial gate. A trial now permits a valid pending-outbox count. Post-enable Chat health must pass, and standard final enablement still requires an empty outbox.

These fixes do not establish that the VM can meet the original capacity target. No additional load messages were authorized or sent after the owner's decision.

## Storage and backups

The [storage check](storage.json) used the production schema, 700,000 messages of 500 ASCII characters, and production encrypted backup code. It reserves about 6.62 GiB for Chat storage and backup workspace before the 25% margin, authentication-backup allowance, and 10 GiB free-disk floor. The VM had sufficient space.

An encrypted authentication-only backup preceded deployment. The new paired authentication and Chat backup succeeded at 16:19 UTC. The daily backup timer is installed. The independent encrypted Chat restore drill passed locally.

## Final deployment

The [final verification report](checks.json) passes lint, type checking, 336 unit tests, 70 browser tests with 10 existing skips and no retries, the independent restore drill, the production build, Streaming contract checks, Compose validation, and both proxy regression checks. Astra medium reviewers found no remaining code blockers.

The [live rollout check](rollout-proof.json) preserved all 2,009 messages and the database schema. Disable closed Chat sockets and restored the placeholder; re-enable restored the transcript. Its stronger player-continuity assertion failed during viewer recreation, so that report remains marked false. Environment-flag changes recreate the viewer and can interrupt playback through temporary authentication unavailability. This is a deployment limitation; the partial load itself recorded no playback interruption or recovery.

The final browser check confirms visible Chat and real H.264 playback. Three [post-load host samples](final-host.json) show both services healthy, SQLite integrity `ok`, zero pending deliveries, at least 3.44 GiB available memory, and sampled CPU between 42.8% and 48.5%.

All [100 temporary accounts are disabled](account-cleanup.json), with zero remaining sessions. The rollback timer was cancelled under the [owner acceptance record](owner-acceptance.json). Chat remains enabled.

The owner then requested removal of all test messages. [Cleanup deleted all 2,009 test messages](message-cleanup.json), cleared broker recovery history, and made connected clients reload the transcript. No other account messages were removed. A new encrypted backup replaced the earlier set from the same day. [Direct decryption and database checks](backup-cleanup.json) confirm zero test messages in that backup and the live database. Temporary local credentials and the remote test-session record were removed. This targeted cleanup did not restart the viewer or MediaMTX. The capacity exception applies to this deployment only. Future standard deployments still disable Chat and require fresh verification.
