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

Only the CPU, load, memory, filesystem, disk activity, network, and boot-time collectors are enabled. Virtual bridge, container, and loopback interfaces are excluded to reduce duplicate traffic counts. Filesystems under Docker, containerd, device, process, and temporary runtime mounts are excluded. No logs, traces, notifications, or paid-plan changes are configured here.

The root filesystem mount is private and read-only. New host mounts need a collector restart. Mount restrictions, unusual filesystem types, and restricted `/proc` access can remove measurements. The collection-success panel reports collector failures.

The pinned collector image also uses disk space. Docker image layers, the current release, and the previous release are outside the log limit. Their measured size belongs in the deployment headroom record.

Configuration can move to another Prometheus-compatible endpoint by changing the private environment file. The dashboard selects its data source at import time. Old Cloud history does not move automatically.

The configuration follows the Alloy references for [host measurements](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.exporter.unix/), [scrape limits](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.scrape/), and [remote-write buffering](https://grafana.com/docs/alloy/latest/reference/components/prometheus/prometheus.remote_write/).
