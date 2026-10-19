# VM collector limits

These limits apply to `compose.yaml` and `config.alloy`. Grafana Cloud account usage requires a separate check before deployment.

| Resource | Limit |
| --- | --- |
| CPU | 0.25 CPU core |
| Container memory | 512 MiB, including temporary files. No additional swap allowance |
| Go memory target | 192 MiB. This is a runtime target, not a hard process limit |
| Process count | 64 |
| Metrics buffer | 256 MiB in memory. No persistent WAL volume |
| Other temporary files | 8 MiB in memory |
| Container logs | Two files of 5 MiB each |
| Scrape frequency | Every 15 seconds, with a 10-second timeout |
| Scrape ceiling | 2,000 samples per target before the separate forwarding filter |
| Forwarded metrics | Explicit metric-name lists. Seven host collectors. No process, account, request, or viewer labels |
| Send queue | At most two shards, each with capacity for 1,000 samples |
| Send batch | At most 500 samples, flushed every 5 seconds |
| HTTP request timeout | 10 seconds |
| Retry delay | Starts at 1 second, grows to 30 seconds. A server `Retry-After` can extend the delay |
| Retryable failures | Network errors, HTTP 5xx, and HTTP 429 |
| Sample age | Samples older than one hour are not sent |
| WAL cleanup | Every 15 minutes. Minimum age 5 minutes, maximum age 1 hour |

Alloy uses its own metric names for queue health. The stored dashboard queries these metrics through the selected Prometheus data source. The process-memory panel excludes the temporary buffer. Docker memory measurements include that buffer.

The temporary filesystem is the hard storage bound. WAL cleanup is periodic, so age settings do not guarantee a byte limit. If the buffer fills, collection can fail. Container removal or restart loses unsent samples. These events cause gaps. They do not delete samples already stored in Cloud.

The scrape ceiling fails a whole scrape if the exporter exceeds it. The forwarding filter then removes unused measurements. The ceiling is not a Cloud-wide quota: series changes over time and other collectors can increase account usage. A small VM normally stays far below it, but production acceptance requires a measured series count.

Only the CPU, load, memory, filesystem, disk activity, network, and boot-time collectors are enabled. Virtual bridge, container, and loopback interfaces are excluded to reduce duplicate traffic counts. Filesystems under Docker, containerd, device, process, and temporary runtime mounts are excluded. Service logs use the separate limits below. Traces, new notifications, and paid-plan changes are not configured here.

The root filesystem mount is private and read-only. New host mounts need a collector restart. Mount restrictions, unusual filesystem types, and restricted `/proc` access can remove measurements. The collection-success panel reports collector failures.

The pinned collector image also uses disk space. Docker image layers, the current release, and the previous release are outside the log limit. Their measured size belongs in the deployment headroom record.

Configuration can move to another Prometheus-compatible endpoint by changing the private environment file. The dashboard selects its data source at import time. Old Cloud history does not move automatically.

The configuration follows the Alloy references for [host measurements](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.unix/), [scrape limits](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.scrape/), and [remote-write buffering](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.remote_write/).

## Service and log limits

| Resource | Limit |
| --- | --- |
| Observer CPU / memory / processes | 0.10 core / 96 MiB, no extra swap / 32 |
| Observer JavaScript heap | 32 MiB; the container limit also covers HTTP buffers |
| Observer disk | Read-only root; two local diagnostic files of 1 MiB each |
| Docker project / services | One project; seven fixed service names; at most 32 discovered containers |
| Polling | Every 15 seconds; no overlapping polls |
| Reads | Two-second deadline, 1 MiB per Docker response, 16 KiB health response |
| Raw log scan | Last 200 lines per service per poll; at most 8 KiB per line |
| Export batch | At most 64 records and 64 KiB per poll, across all services |
| Local handoff | One attempt, two-second timeout; failed records are counted and discarded |
| Health heartbeat | At most one per minute, plus health changes |
| Loki labels | Four fixed dimensions; seven service values, three level values; no release label |
| Alloy log queue | Pinned Alloy default: 10 MiB, in memory; no Loki WAL |
| Cloud log batch | 64 KiB, flushed after one second |
| Cloud delivery | Five-second request timeout; six backoff retries, one to ten seconds; no infinite retry |
| Metrics scrape | 2,000 samples per service-observer scrape; explicit forwarding filter |

The export ceiling is about 10.6 GiB per 30 days at continuous maximum volume, before protocol overhead. Actual records are usually much smaller. This is not an account-wide quota; check total Cloud log usage and active series after deployment and before other tickets add data. Keep the account on Free. Do not enable paid upgrades.

A receiver outage can discard logs after retries, during queue pressure, or when the collector restarts. The observer does not store a backlog. It counts local delivery failures, discarded records, and windows where a read failed or hit the 200-line ceiling. A gap count identifies affected polls, not the exact number of lost lines. The pinned Alloy queue can block; the observer timeout prevents that wait from reaching the application. Metrics and Loki loss counters remain separate.

The observer reads only the latest poll interval after it restarts. It does not backfill an unbounded outage. A Loki outage does not write to application storage. Full raw Docker log retention remains the application's existing responsibility. Inspect the dashboard's delivery counters and query recent logs; a successful local handoff alone does not prove Cloud delivery.

See the official [Loki receiver](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.api/) and [Loki writer](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.write/) references. Custom queue settings are experimental in this Alloy release; this deployment uses the pinned stable defaults.

## Channel collection limits

Channel collection shares the service observer's CPU, memory, log, and 15-second polling limits. Each of its three API responses has a two-second deadline and a 1 MiB limit. Each list requests at most 1,000 items; additional pages fail the collection instead of producing partial counts. At most 100 standard Channel paths are retained for the process lifetime. Additional paths are unassigned and set `monitoring_channel_capacity_exceeded` to 1.

Channel measurements use only `channel`, fixed `protocol`, and fixed `direction` labels, plus the existing instance and job. There are at most 15 measurements per retained Channel, plus five collection measurements. Viewer IDs, source-session IDs, derived paths, remote addresses, and query strings are never exported. Counter checkpoints stay in memory and are replaced each poll. Collector restart loses those checkpoints, so the first rate interval is incomplete. Cloud account usage also includes historical label churn; this process cap is not an account-wide quota.
