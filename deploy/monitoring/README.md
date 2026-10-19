# Deploy VM monitoring

Use this collector on the Linux streaming VM. It sends VM, service, and Channel measurements to Grafana Cloud every 15 seconds. The application deployment does not manage it.

## Prepare the Cloud stack

For guided setup, run this command on your computer:

```sh
bash deploy/monitoring/setup-cloud.sh
```

The wizard opens the Cloud pages and saves the connection values to `~/.config/mediamtx-monitoring/collector.env` with mode `0600`. Token input is hidden. Give the agent that file path and the VM SSH target to continue deployment. Do not send the token in chat. The wizard does not deploy the collector.

For manual setup, use these steps:

1. Select a Grafana Cloud **Free** stack. Keep the Free plan. Do not enable a paid upgrade.
2. Keep access limited to three named administrators. In the Cloud access settings, invite each administrator separately to this stack. Do not share an account.
3. Remove other stack users. Disable public dashboard sharing and anonymous access. Do not create public snapshots.
4. Create separate Cloud access policies for this stack with only `metrics:write` and `logs:write`, respectively. Create a token with an expiry date. Record its renewal date outside the repository.
5. Copy the Prometheus remote write and Loki push **HTTPS URLs**, tenant IDs, and their tokens from the stack connection details.
6. Create `/etc/mediamtx-monitoring` on the VM with mode `0700`. Copy `.env.example` to `/etc/mediamtx-monitoring/collector.env` with mode `0600`.
7. Edit that file locally on the VM. Keep `MONITORING_INSTANCE` stable across restarts. Use one label per VM.

Keep tokens out of command arguments, logs, screenshots, Git, and chat. Do not print `docker compose config` or the container environment with real credentials. Docker administrators can read container environment values.

For access removal, remove the person from the stack and its Cloud organization if no other access is needed. Revoke any tokens that person controlled. Check the stack user list after each change. Application roles do not grant or revoke Grafana access.

## Check the VM before deployment

Run these commands on the actual VM during normal publishing and playback. Save the results in the deployment record, with the UTC time and active Channel count.

```sh
date -u
nproc
free -b
df -B1 / /var/lib/docker
df -i / /var/lib/docker
vmstat 1 6
ss -lnt '( sport >= :12345 and sport <= :12348 )'
docker system df
```

Use the final five `vmstat` rows. The first row is an average since boot. Proceed only if CPU use stays below 70%, available memory exceeds 1.7 GiB for both monitoring containers and the 1 GiB reserve, and free disk space exceeds 10 GiB plus the existing deployment reserve and collector image space. Ports `12345` through `12348` must be unused.

Do not infer capacity from Terraform defaults. After deployment, repeat these measurements under load. Keep at least 1 GiB of available memory and CPU use below 70%. If either threshold fails, stop the collector and record the result.

## Install the collector

Copy `deploy/monitoring/`, `lib/media-readers.ts`, `lib/whip-pilot.ts`, and `lib/monitoring-labels.ts` into a versioned directory such as `/opt/mediamtx-monitoring/releases/<commit>/`, preserving these repository-relative paths. Keep the previous version for rollback. Run the following commands from its `deploy/monitoring/` directory as a Docker administrator. Use the same Compose project name for every version.

```sh
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring pull
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring run --rm --no-deps alloy validate /etc/alloy/config.alloy
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring up -d
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring ps
curl --fail http://127.0.0.1:12345/-/ready
```

The readiness response checks the collector configuration. It does not prove delivery. Check data in Grafana next.

Alloy uses the host network and read-only host mounts to measure the VM. It runs as UID `65534`, drops all capabilities, and has no Docker socket. It can read world-readable host files. Keep application credentials readable only by their service account or root. Keep Docker management private.

Do not add inbound firewall rules. The base monitoring listeners use VM loopback. The optional trace receiver uses the private Docker bridge gateway. Alloy needs outbound HTTPS to the Cloud metrics and logs endpoints. Restart the collector after a host filesystem mount changes so its filesystem view is current.

## Import and check the dashboard

1. In Grafana, import `vm-health.json`, `service-health.json`, `channel-health.json`, and `request-performance.json` into a folder limited to the administrator accounts.
2. Select the stack's existing Prometheus data source in **Metrics source**. Select the VM in **VM**. For service logs, select the existing Loki data source in **Logs source**. Use **Service**, **Release (logs)**, and the time selector to filter events. The release filter affects logs only.
3. Wait one minute. Check CPU, load, memory, disk space, inodes, disk activity, and interface traffic. The dashboard refreshes every 15 seconds.
4. Compare memory and filesystem values with `free` and `df` on the VM. Publish to a test Channel and play it. Check that CPU and network rates change.
5. Record the **Current metric series** value and the stack's total active-series usage. The dashboard count is an instant estimate. Cloud usage also includes recently active series and other collectors.
6. Check the **Received sample age**, **Collection success**, queue, and delivery panels. Missing data is a collection gap. Zero traffic is a measurement.
7. Open a private browser window without a Grafana session. Confirm that the dashboard requires login. Request a data-source query URL without credentials and confirm that it returns no data.
8. Remove a test account and verify that its access ends. Keep the final stack user list in the deployment record.

The stack retains recent detailed measurements according to its plan. Interface counters include private VM traffic and protocol overhead. They are not Oracle billing totals. Three-month reports are a later ticket.

## Restart, disable, and roll back

Run commands from the installed version directory.

```sh
# Restart the collector. Unsent samples in its temporary buffer are lost.
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring restart alloy

# Disable monitoring. The application and stored Cloud history stay in place.
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring down
```

To roll back, change to the previous version directory. Run the validation command and `up -d --remove-orphans` from that directory. This also removes an observer that is absent from the older version. Reimport its dashboard JSON. To rotate a token, update the private environment file, then run `up -d --force-recreate`. Revoke the old token after delivery resumes.

Verify publishing and playback while the collector is stopped, then after it starts again. Check that earlier samples remain visible in Grafana. Record this result before you accept a production deployment.

If the endpoint fails, check the token expiry, endpoint URL, tenant ID, and outbound connection. Review the last 20 collector log lines locally. Do not paste logs that contain credentials. Fix the cause, then check that sample age returns to normal. Restarting clears the temporary queue if it is full.

Keep only the current and previous monitoring release assets and image versions. Remove an obsolete monitoring image by its exact digest after rollback is no longer needed. Do not prune application images.

## Run the focused test

Use Node 24 and a local Docker engine. The test uses the repository's FFmpeg fixture and pinned Alloy, Prometheus, Grafana, and MediaMTX images.

```sh
npx vitest run scripts/service-monitoring.test.mjs scripts/monitoring-deployment.test.mjs
npm run typecheck
```

On Docker Desktop, set `DOCKER_CONTEXT=desktop-linux`. Measurements describe the Docker Linux VM. This test checks real delivery, Grafana queries and denied anonymous requests, container limits, endpoint interruption, collector restart, and sample stream playback, real Loki queries, secret exclusion, and bounded log delivery failures. It does not check Oracle capacity or Cloud account settings.

Run the full Docker suite after the final monitoring ticket, as agreed. See [collector limits](limits.md) for the collection budget and data-loss limits.

The setup instructions use Grafana's references for [stack connection details](https://grafana.com/docs/grafana-cloud/security-and-account-management/cloud-stacks/) and [access policies and tokens](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/).

## Service observer permissions and log fields

The `services` container reads Docker state and logs for seven fixed services in `MONITORING_PROJECT`. Its default is `mediamtx-viewer`. The observer also reads the viewer's internal `/api/health` response. It does not change application services or the existing Chat notifier. It has no Cloud credentials.

**The observer has Docker administrator access.** A `:ro` socket mount prevents filesystem writes to the socket mount; it does not restrict Docker API methods. The observer uses only fixed GET requests, but a compromised observer could control Docker and the host. Keep the pinned image and script restricted to administrators. Alloy has no Docker socket. No Docker API proxy or remote management listener is exposed.

The observer does not export raw log text. It classifies known service messages and produces fixed descriptions. Allowed fields are `event`, `level`, `message` (fixed descriptions), `code` (a fixed error or Chat fault enum), `release` (validated version), `running`, `available`, `health`, `chat` (enums), `restarts` (number), `channel` (a standard Channel path), and `live` (boolean). Channel paths appear only in Channel state events. Stream labels are only `job`, `instance`, `service`, and `level`. Account identity, IP addresses, URLs, Channel display names, tokens, stream keys, Chat content, stack traces, and arbitrary object fields are excluded. Unknown messages are discarded and counted. For deeper diagnosis, an administrator can inspect raw Docker logs locally.

The service dashboard shows container state, health, restart count, last start time, application version and availability, available Chat state and outbox measurements, and approved events. A container replacement resets its Docker restart count; state events and start time preserve replacement evidence. A missing Docker health check is `-1`, not a success. A failed collection removes old service readings instead of reporting stale health. Dashboard links preserve VM and time selection.

Check a controlled error in an isolated fixture before production acceptance. Search its fixed error code in Grafana, compare the application health chart for that time, then follow the VM link. Do not stop a live Channel or generate real Chat notifications for this check. Confirm that the Cloud stack still uses its selected 14-day retention. This deployment creates no alert rules or contact points.

## Channel activity and traffic

The observer reads three internal MediaMTX API lists every 15 seconds: paths, HLS sessions, and WebRTC sessions. It uses the Docker bridge address and private port 9997. Do not expose this port. Failed or partial lists remove Channel readings; the collection-success panel shows the failure. No application release or new API is required.

The dashboard lists standard Channel paths (`live` and `channels/<slug>`) observed since the collector started, including their later offline state. It does not list an inactive Channel that MediaMTX has never exposed. Custom paths, old HLS derivatives, and paths above the 100-Channel limit remain in the **Unassigned paths and connections** count. The collector does not guess their owner. Restarting clears the observed-path set; history already sent to Grafana remains available.

The observer imports the same Viewer identity and HLS derivative helpers as the application. A valid `frankerzspam_viewer` ID counts once across concurrent HLS and WebRTC connections. Sessions without that ID count separately, as in the application. Internal RTSP readers, HLS muxers, and thumbnail sessions do not count as Viewers. The current ready HLS derivative maps to its original Channel only when its Publisher generation matches. Its worker is not a second Publisher.

Traffic uses the current fields in pinned MediaMTX 1.20.1:

| Measurement | Source | Meaning |
| --- | --- | --- |
| Publisher media input | Original path `inboundBytes`; native `paths_inbound_bytes` | Media bytes received by the path. The derived copy is excluded |
| HLS Viewer transfer | Public HLS session `outboundBytes`; native `hls_sessions_outbound_bytes` | Bytes returned by the HLS session |
| WebRTC Viewer transfer | Public read session `outboundBytes`; native `webrtc_sessions_outbound_bytes` | Bytes sent by the WebRTC connection |

These protocol counters are estimates, not VM-interface totals or provider billing. Do not add path outbound counters to session counters: this would count the same transfer twice. The observer does not use deprecated `bytesReceived` or `bytesSent` fields. The pinned [API schema](https://github.com/bluenviron/mediamtx/blob/v1.20.1/api/openapi.yaml) and [metric definitions](https://github.com/bluenviron/mediamtx/blob/v1.20.1/internal/metrics/metrics.go) define the source fields. The disposable test checks the fields and native metric names against that image.

Rates use consecutive counter deltas for the same sessions. Startup, session joins or departures, counter resets, missing metadata, or gaps longer than 45 seconds make the interval incomplete. The dashboard suppresses uncertain rates for the affected direction and protocol. Other valid rates remain visible. Incomplete connection data suppresses Viewer and connection counts. A connection that starts and stops between polls, or its final bytes after the last poll, can be missed. These live rates are not retained bandwidth summaries; that is a later ticket.

Normal starts and stops produce `channel_started` and `channel_stopped` information events. Initial states use `channel_observed`. Collection failure alone produces no stop event. Events share the existing bounded log queue, so loss counters also apply to them. Changes that occur entirely between polls can be missed. No alert or notification is created.

For acceptance, use the disposable Docker test to publish, open WebRTC, add HLS with the same Viewer ID, and close WebRTC. The count must stay at one Viewer while the protocol counts change. Then stop and restart the Publisher and check the Grafana state events. The separate WHIP media test checks a real HLS derivative and internal worker. Never use a live user's Channel for this check.

## Request performance and traces

This feature needs an application release as well as the collector. Keep `MONITORING_ENABLED=false` until the managed application release passes its required checks. For this monitoring series, run the full Docker suite after ticket 10, then activate tracing through the normal release process. Do not copy application files into a running production container.

1. In the Grafana Cloud portal, open the stack's OpenTelemetry connection details. Copy the **HTTP traces endpoint** and tenant ID. Use the full URL ending in `/v1/traces`. If the portal gives an OTLP base URL ending in `/otlp`, append `/v1/traces`. Do not use the Tempo query URL or gRPC address.
2. Create a stack-scoped Cloud access policy with only `traces:write`. Save its token as `GRAFANA_TRACES_TOKEN` in the existing private `collector.env` file. Save the endpoint and tenant ID as `GRAFANA_TRACES_URL` and `GRAFANA_TRACES_USER`. Keep mode `0600`. The Grafana dashboard service-account token cannot send traces.
3. Check that `172.28.0.1` is the gateway of `viewer_net`. Set `MONITORING_OTLP_LISTEN_ADDRESS=172.28.0.1:4318`. Keep port 4318 private. The receiver has no authentication and trusts the private bridge. Do not bind it to the public interface or add an ingress rule. Other trusted containers on this bridge can send telemetry.
4. From the new monitoring release directory, validate and start both files:

   ```sh
   docker compose --env-file /etc/mediamtx-monitoring/collector.env -f compose.yaml -f compose.traces.yaml -p mediamtx-monitoring run --rm --no-deps alloy validate /etc/alloy/with-traces
   docker compose --env-file /etc/mediamtx-monitoring/collector.env -f compose.yaml -f compose.traces.yaml -p mediamtx-monitoring up -d
   ```

5. Set `MONITORING_ENABLED=true` in the application's private deployment environment. Deploy the verified application release. The app sends OTLP to the private gateway and serves metrics on port 9464 inside its container. The Compose file publishes no metrics port. The existing observer reads metrics through the Docker bridge; only its loopback endpoint is scraped by Alloy. No Cloud token enters the application.
6. Import `request-performance.json` into the administrator folder. Select the Prometheus, Loki, and Tempo data sources. Check request rate, error rate, p95 latency, database timings, collection state, queue size, and loss counts. Select a trace ID in the failure table or recent trace table to open it in Grafana Explore. Use the same VM, route, and time range to compare errors with latency.

OpenTelemetry starts from `instrumentation.ts`. It samples 10% of root requests. Child spans keep the local parent's decision. Incoming `traceparent`, `tracestate`, and baggage do not control the sample or exported IDs. Request counts, error counts, and database timing histograms include unsampled requests. Errors include HTTP 4xx and 5xx; selected JSON error logs cover 5xx and failed native spans. Selected logs are limited to eight per 15 seconds, before the observer's existing log limits.

The route label is a fixed application route template. Unknown routes use `/unmatched`; query strings, account IDs, Channel slugs, and OBS setup codes cannot create labels. Static asset and unmatched requests share that bucket. `/api/channel-events` remains open during an event stream, so its duration is connection duration and its request counter changes when it closes. Media payloads served directly by Caddy or MediaMTX are outside application request timing. Their measurements remain on the Channel dashboard.

Database coverage is explicit:

| Operation | Function | Measured work |
| --- | --- | --- |
| `account_access` | `getAccountAccess` | Account access query |
| `channel_watch_access` | `canWatchChannel` | Channel viewing permission query |
| `channel_list` | `getChannels` | Channel list query |
| `channel_read` | `getChannel` | Single Channel query after input validation |

These timings include synchronous statement preparation and execution. They exclude result mapping, other database queries, migrations, and auth-provider internals. Database spans attach to the current request when one exists. They contain only the fixed operation name, duration, and success/error status. No SQL text, parameters, or results are captured.

Native Next spans are projected before entering the export queue. The projection retains timing, generated trace/span IDs, normalized method/route/status, fixed span names, and the application version. It discards URLs, headers, cookies, bodies, exceptions, events, links, and arbitrary attributes. Alloy applies a second allowlist and rejects unexpected events, links, route values, methods, and operations. Request error logs use the same route/method vocabulary, status, release, and optional trace ID. The ID is a JSON field, never a metric or Loki stream label.

A sampled request does **not** guarantee a saved or complete trace. Queue limits, volume limits, restarts, timeouts, and backend rejection can discard spans. An unsampled error log has no trace ID. Start with the counters and logs when trace lookup fails. To stop tracing, disable `MONITORING_ENABLED` through the managed application deployment, then return the collector to `compose.yaml` alone. Previously stored Cloud history remains subject to its retention period. Self-hosting later changes the collector's OTLP destination and Grafana data source; application instrumentation stays the same.

Run the focused checks with Node 24:

```sh
npx vitest run lib/request-monitoring.integration.test.ts scripts/service-monitoring.test.mjs
DOCKER_CONTEXT=desktop-linux npx vitest run scripts/monitoring-deployment.test.mjs -t 'exports real Next requests'
```

The second test builds the real application image and runs isolated Next.js, Alloy, Tempo, Loki, Prometheus, and Grafana containers. It uses a disposable SQLite database and fixture credentials. Production credentials and live Channels are not used. The [Alloy OTLP exporter reference](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.otlphttp/) describes the portable destination and queue configuration.
