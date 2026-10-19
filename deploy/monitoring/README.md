# Deploy VM monitoring

Use this collector on the Linux streaming VM. It sends VM measurements to Grafana Cloud every 15 seconds. The application deployment does not manage it.

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
4. Create a Cloud access policy for this stack with only `metrics:write`. Create a token with an expiry date. Record its renewal date outside the repository.
5. Copy the Prometheus remote write **HTTPS URL**, tenant ID, and token from the stack connection details.
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
ss -lnt '( sport = :12345 )'
docker system df
```

Use the final five `vmstat` rows. The first row is an average since boot. Proceed only if CPU use stays below 70%, available memory exceeds 1.5 GiB, and free disk space exceeds 10 GiB plus the existing deployment reserve and collector image space. Port `12345` must be unused.

Do not infer capacity from Terraform defaults. After deployment, repeat these measurements under load. Keep at least 1 GiB of available memory and CPU use below 70%. If either threshold fails, stop the collector and record the result.

## Install the collector

Copy this directory to a versioned directory on the VM, such as `/opt/mediamtx-monitoring/releases/<commit>/`. Keep the previous version for rollback. Run the following commands from that directory as a Docker administrator. Use the same Compose project name for every version.

```sh
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring pull
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring run --rm --no-deps alloy validate /etc/alloy/config.alloy
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring up -d
docker compose --env-file /etc/mediamtx-monitoring/collector.env -p mediamtx-monitoring ps
curl --fail http://127.0.0.1:12345/-/ready
```

The readiness response checks the collector configuration. It does not prove delivery. Check data in Grafana next.

The collector uses the host network and read-only host mounts to measure the VM. It runs as UID `65534`, drops all capabilities, and has no Docker socket. It can read world-readable host files. Keep application credentials readable only by their service account or root. Keep Docker management private.

Do not add inbound firewall rules. The collector's HTTP server listens only on VM loopback. It needs outbound HTTPS to the Cloud metrics endpoint. Restart the collector after a host filesystem mount changes so its filesystem view is current.

## Import and check the dashboard

1. In Grafana, import `vm-health.json` into a folder limited to the administrator accounts.
2. Select the stack's existing Prometheus data source in **Metrics source**. Select the VM in **VM**.
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

To roll back, change to the previous version directory. Run the validation command and `up -d` from that directory. Reimport its dashboard JSON. To rotate a token, update the private environment file, then run `up -d --force-recreate`. Revoke the old token after delivery resumes.

Verify publishing and playback while the collector is stopped, then after it starts again. Check that earlier samples remain visible in Grafana. Record this result before you accept a production deployment.

If the endpoint fails, check the token expiry, endpoint URL, tenant ID, and outbound connection. Review the last 20 collector log lines locally. Do not paste logs that contain credentials. Fix the cause, then check that sample age returns to normal. Restarting clears the temporary queue if it is full.

Keep only the current and previous monitoring release assets and image versions. Remove an obsolete monitoring image by its exact digest after rollback is no longer needed. Do not prune application images.

## Run the focused test

Use Node 24 and a local Docker engine. The test uses the repository's FFmpeg fixture and pinned Alloy, Prometheus, Grafana, and MediaMTX images.

```sh
npx vitest run scripts/monitoring-deployment.test.mjs
npm run typecheck
```

On Docker Desktop, set `DOCKER_CONTEXT=desktop-linux`. Measurements describe the Docker Linux VM. This test checks real delivery, Grafana queries and denied anonymous requests, container limits, endpoint interruption, collector restart, and sample stream playback. It does not check Oracle capacity or Cloud account settings.

Run the full Docker suite after the final monitoring ticket, as agreed. See [collector limits](limits.md) for the collection budget and data-loss limits.

The setup instructions use Grafana's references for [stack connection details](https://grafana.com/docs/grafana-cloud/security-and-account-management/cloud-stacks/) and [access policies and tokens](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/access-policies/create-access-policies/).
