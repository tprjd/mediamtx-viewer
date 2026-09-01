# Oracle usage statistics plan

## Goal

Add a signed-in viewer page at `/statistics` that answers two separate
questions without conflating them:

1. Is the Oracle tenancy still inside the documented Always Free allowances?
2. Is the MediaMTX viewer VM healthy right now?

OCI billing and usage data is authoritative for the first question. Compute
metrics are operational diagnostics only and must never be used by themselves
to declare the tenancy free.

## Page contents

- An overall `Safe`, `Watch`, `Near limit`, `Charge detected`, or `Unknown`
  result with an explanation and source timestamps.
- Current-month cost and forecast cost from the OCI Usage API.
- Allowance cards for Ampere A1 OCPU-hours, A1 memory GB-hours, block storage,
  and outbound transfer.
- Current viewer instance state, shape, OCPU count, memory, boot-volume size,
  region, and uptime.
- CPU, memory, load, network, and disk charts for one hour, 24 hours, or seven
  days.
- A cost table grouped by service, SKU, and unit.
- A source-health section that makes missing permissions, stale billing data,
  missing monitoring-agent data, and unknown SKU mappings visible.

No OCID, credential, raw OCI response, or private IP is rendered into the page.

## Oracle data sources

| Information | OCI source | Refresh target |
| --- | --- | --- |
| Current and forecast cost, tenancy-wide metered usage | Usage API | 1 hour |
| Instance allocation and boot volume | Compute and Block Volume APIs | 5 minutes |
| CPU, memory, load, network, and disk activity | Monitoring API | 1 minute |
| Instance, tenancy, compartment, and region identity | Instance Metadata Service v2 | 5 minutes |

The Usage API query covers the whole tenancy. Restricting it to the application
compartment could miss another resource consuming an Always Free allowance or
incurring a charge.

## Authentication and authorization

The Next.js server prefers a dedicated least-privilege OCI API-key identity for
all SDK calls. Terraform permits that identity to:

- inspect tenancy and compartment metadata required by usage reports;
- read metrics in the viewer compartment;
- read the viewer instance and volume inventory in that compartment.

The generated key is stored in the git-ignored deployment secrets directory and
mounted read-only; it is not built into the container image. A dynamic group
matching the exact viewer instance keeps instance-principal access as a fallback
for inventory and monitoring when the key is not configured. Usage reporting
still requires the dedicated API-key identity.

No personal OCI configuration or expiring browser session token is stored in
the application or container. The page reuses the existing active session
boundary and has no client-callable privileged OCI API. The separate
user-management link remains administrator-only.

If billing data is temporarily unavailable, compute and memory projections use
the current VM allocation as a clearly labelled lower bound. Cost and outbound
transfer remain unknown rather than being inferred from operational metrics.

## Reference allowances and status rules

Defaults follow the current Oracle documentation and remain configurable:

- 3,000 Ampere A1 OCPU-hours per month;
- 18,000 Ampere A1 GB-hours per month;
- 200 GB combined boot and block volume storage;
- 10,000 GB outbound transfer per month.

The page displays the source links and labels these values as references because
Oracle can revise the program. OCI's returned cost remains authoritative.

Status is calculated conservatively:

- `Charge detected` when current-month cost exceeds a small currency-rounding
  tolerance.
- `Near limit` when known projected usage reaches 85% of an allowance.
- `Watch` when known projected usage reaches 70%.
- `Safe` only when the tenancy-wide cost query succeeded, cost is zero, required
  inventory is available, no relevant SKU is unmapped, and known projections
  remain below the warning thresholds.
- `Unknown` when authoritative billing data is unavailable or stale, required
  permissions are missing, or relevant usage cannot be classified.

Time-based usage is projected from elapsed UTC month time. Allocated storage is
not projected. The interface identifies partial, app-instance-only allocation
figures rather than presenting them as tenancy totals.

## Application design

- A server-only data-access layer constructs sanitized DTOs for the page.
- OCI sources fail independently so one failed service does not blank the page.
- A bounded in-memory TTL cache avoids querying Oracle on every page render.
- A manual refresh bypasses the cache; no SSE or continuous billing polling is
  added.
- The page is a dynamic Server Component. A tiny server-rendered SVG chart keeps
  OCI SDK code and raw telemetry out of the browser bundle.
- Production enables the integration explicitly with `OCI_STATS_ENABLED=true`.
  Local development shows an intentional unavailable state unless configured on
  an OCI instance.

## Infrastructure and rollout

1. Reauthenticate the deployment OCI CLI profile.
2. Apply the Terraform dynamic group and policy.
3. Verify or install Oracle Cloud Agent on Ubuntu and enable the Compute Instance
   Monitoring plugin.
4. Deploy the application stack.
5. Compare the page's cost, inventory, and metrics with OCI Console Cost
   Analysis and Monitoring.
6. Optionally add a small OCI budget email alert as an independent safety net.

## Acceptance criteria

- Every active signed-in viewer can open the page; anonymous and disabled users cannot.
- The page never reports `Safe` while the Usage API result is missing or stale.
- Cost totals and forecast agree with OCI Console within Oracle's reporting delay
  and rounding.
- The current deployment reports the expected A1 allocation: 1 OCPU, 6 GB RAM,
  and a 50 GB boot volume.
- One OCI service failure leaves other valid sections visible.
- Monitoring-agent absence is explained rather than rendered as zero usage.
- Calls are cached at the intended cadence, and manual refresh bypasses them.
- No OCI secrets or full resource identifiers reach HTML, client JavaScript, or
  application logs.
- UTC month boundaries, zero and nonzero costs, warning thresholds, unknown
  SKUs, missing permissions, and empty metric series have automated coverage.
