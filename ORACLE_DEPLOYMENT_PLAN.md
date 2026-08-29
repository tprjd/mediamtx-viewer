# Oracle Relay Deployment Plan

> Status: infrastructure and application deployed with DNS, TLS, and access
> controls verified. A real OBS publish and external playback test remain.

## Objective

Run the complete viewer stack on an Oracle Cloud Always Free VM and publish to
it from OBS. Friends connect only to Oracle, so the home public IP is never a
playback endpoint and no inbound home-router ports are required.

The first deployment should remain personal, non-commercial, inexpensive, and
small enough to restore from the files in this repository.

## Recommended architecture

```text
Home                                           Oracle Cloud VM
────                                           ───────────────
OBS ── one outbound WHIP stream ─────────────> Caddy
                                                  │
                                                  ├── MediaMTX
                                                  │   ├── WebRTC/WHEP
                                                  │   ├── HLS fallback
                                                  │   └── private Control API
                                                  │
Friends ── HTTPS/WebRTC ─────────────────────>    └── Next.js viewer
```

The viewer, media server, and TLS proxy should initially live on the same VM.
This is simpler and safer than splitting the frontend onto Vercel:

- Caddy can protect the site and playback endpoints with one authentication
  boundary.
- Playback remains same-origin, avoiding CORS and cross-origin credential
  problems.
- HLS segments never use Vercel's 100 GB transfer allowance.
- The existing relative `/media/hls/*` and `/media/whep/*` URLs continue to
  work.
- The Next.js server can query the MediaMTX Control API over a private Docker
  network.

Vercel can be reconsidered later for frontend-only hosting, but it is not part
of the first deployment.

## Traffic and privacy model

OBS sends exactly one encoded stream to Oracle. Oracle then sends one copy to
each viewer. At a 6 Mbps source bitrate, one hour is approximately 2.7 GB:

| Direction | One-hour transfer | Treatment |
| --- | ---: | --- |
| Home OBS to Oracle | 2.7 GB total | Home upload; Oracle ingress |
| Oracle to one viewer | 2.7 GB | Oracle outbound |
| Oracle to five viewers | 13.5 GB | Oracle outbound |

Oracle's documented Always Free allowance currently includes up to 10 TB of
outbound data per month. Usage must still be monitored because plan terms and
limits can change.

This design hides the home IP from viewers because there is no viewer-to-home
connection. Authorized viewers will see the Oracle address, which is expected.
Oracle and the ISP can still observe their respective ends of the publishing
connection.

## Public endpoints

Only these ports should be reachable on the Oracle VM:

- TCP 80: ACME validation and redirect to HTTPS.
- TCP 443: viewer pages, status routes, HLS, and WHIP/WHEP signaling.
- UDP 8189: WebRTC media/ICE.
- TCP 22: administration, restricted to a trusted IP or private VPN wherever
  practical.

Do not expose MediaMTX ports `8888`, `8889`, or `9997` directly. Caddy is the
only public HTTP entry point, and the Control API remains private.

Use a reserved Oracle public IP. A free hostname pointing to the Oracle IP is
recommended because normal automated TLS is much easier and the hostname
reveals only Oracle, not the home connection. A raw-IP deployment is possible,
but Let's Encrypt IP certificates are short-lived and require reliable renewal
automation; treat that as a fallback rather than the default.

Suggested route layout:

- `/` and `/watch/*` -> Next.js viewer
- `/api/channels/*` -> Next.js sanitized status API
- `/media/hls/*` -> MediaMTX HLS listener
- `/media/whep/*` -> MediaMTX WebRTC listener
- `/publish/whep/*` -> MediaMTX WebRTC listener for OBS publishing

The final Caddy route must translate the public prefixes to the paths expected
by MediaMTX without sending video bytes through Next.js.

## Authentication model

Authentication must cover the media endpoints, not only the HTML page. A user
who knows a direct HLS or WHEP URL must not be able to bypass the viewer login.

For the first private deployment:

1. Caddy Basic Auth protects viewer pages, sanitized status APIs, HLS, WHEP,
   and the MediaMTX reader script.
2. MediaMTX ports are reachable only from the Docker network/loopback, so
   MediaMTX may allow read access internally while Caddy enforces public read
   access.
3. OBS publishing bypasses the viewer Basic Auth route but uses a distinct,
   strong MediaMTX publish credential restricted to the `live` path.
4. MediaMTX Control API permission remains local to the Next.js container and
   is never routed publicly.
5. Password hashes, publisher credentials, and environment secrets stay out of
   Git. Commit examples and secret names only.

This produces a browser credential prompt rather than a custom login page, but
it is small, auditable, and works for HLS subrequests and the WebRTC reader. A
custom login can be added later with short-lived JWTs. MediaMTX supports JWT
validation through JWKS and path-scoped permissions, but that adds token
issuance, refresh, native-HLS authorization, and logout behavior that should not
block the initial private deployment.

## Delivery phases

### 1. Provision Oracle infrastructure

- Create an Always Free-eligible VM in an available nearby region.
- Prefer an ARM Ampere instance when available; use an eligible AMD instance if
  ARM capacity is unavailable.
- Start with enough memory for Docker, Next.js, Caddy, and MediaMTX without
  allocating the entire free tenancy quota.
- Attach a reserved public IP.
- Create network rules only for TCP 80/443, UDP 8189, and restricted SSH.
- Patch the operating system and enable automatic security updates.
- Install Docker Engine and the Compose plugin.
- Record the region, shape, image, disk size, and firewall rules in deployment
  documentation.

Exit check: the VM is reachable over restricted SSH, unused public ports are
closed, and a reboot preserves its address and starts Docker.

### 2. Add reproducible cloud deployment files

Add an Oracle-specific deployment directory containing:

- A Compose file for Caddy, MediaMTX, and the viewer.
- A pinned MediaMTX image version.
- A Caddyfile with explicit route ordering.
- A minimal `mediamtx.yml` with only required protocols enabled.
- An environment example listing every required secret without values.
- Persistent Caddy data volumes for certificates.
- Health checks and `restart: unless-stopped` policies.

The viewer image should continue using the existing production Dockerfile. All
services should share a private Compose network; only Caddy and the WebRTC ICE
port should publish host ports.

Exit check: `docker compose config` succeeds and no secret or administrative
port appears in the public bindings.

### 3. Configure TLS and routing

- Point the selected hostname at the reserved Oracle IP.
- Let Caddy obtain and renew its certificate.
- Route UI/status requests to the viewer container.
- Route HLS and WHEP directly to MediaMTX.
- Route the dedicated OBS publish prefix to MediaMTX without viewer Basic Auth.
- Configure security headers and disable unnecessary server-identification
  headers.
- Confirm that HLS segment responses are not buffered or cached incorrectly by
  Caddy.

If a hostname is rejected, implement automated six-day IP-certificate renewal
and test renewal before relying on a raw IP in production.

Exit check: every browser-visible resource uses HTTPS, certificate renewal is
automated, and media requests do not pass through Next.js.

### 4. Configure MediaMTX

- Enable WebRTC and HLS; disable unused public protocols unless needed for
  diagnostics.
- Bind HLS, WHEP/WHIP signaling, and the Control API to the private network.
- Bind WebRTC media on UDP 8189.
- Advertise only the reserved Oracle IP or chosen Oracle hostname as an ICE
  candidate.
- Configure exact allowed origins even though the initial deployment is
  same-origin.
- Allow one publisher on the `live` path and decide explicitly whether a new
  publisher may replace an existing publisher.
- Add a publisher credential with `publish` permission for `live` only.
- Keep API permission private and restrict public read paths to the configured
  allowlist.
- Leave recording disabled unless retention and disk limits are deliberately
  designed.
- Pin and document the deployed MediaMTX version.

Exit check: MediaMTX exposes no home candidate, Control API is unreachable from
the internet, and unauthenticated publishing is rejected.

### 5. Connect OBS

- Configure OBS to publish with WHIP to the Oracle publish URL.
- Store the publisher credential in OBS, never in the repository or viewer
  configuration.
- Keep the current single 1080p60 AV1/Opus rendition initially.
- Measure the actual sustained bitrate and Oracle CPU/network use.
- Verify that stopping OBS changes the viewer status to offline.
- Verify reconnect behavior after a short network interruption.

If WHIP is unreliable from the home ISP, test SRT as the ingest protocol while
keeping WebRTC/HLS for viewers.

Exit check: OBS reaches Oracle without any home port forwarding and publishing
one stream does not depend on the home public IP remaining stable.

### 6. Protect viewer access

- Generate a strong shared viewer password and a Caddy-compatible password
  hash.
- Protect `/`, `/watch/*`, `/api/channels/*`, `/media/hls/*`, and
  `/media/whep/*` consistently.
- Exclude only the OBS publishing route and ACME challenge path from viewer
  authentication.
- Confirm that a direct HLS manifest, segment, WHEP endpoint, and `reader.js`
  request all fail without credentials.
- Confirm that the publish credential cannot read streams and the viewer
  credential cannot publish.
- Add a documented credential-rotation procedure.

Exit check: copying a media URL into a fresh unauthenticated browser does not
play the stream.

### 7. Adapt and verify the viewer

- Keep playback URLs relative so they resolve through Oracle Caddy.
- Point `MEDIAMTX_API_URL` at the private MediaMTX container address.
- Point build-time HLS and WebRTC origins at their private container addresses
  for local rewrite fallback, while relying on Caddy for public media routing.
- Ensure the public channel API contains no Oracle internal address,
  credentials, or MediaMTX Control API response.
- Run typecheck, lint, unit/component tests, production build, and Playwright
  tests with Chromium installed.
- Test live, offline, reconnecting, unknown-channel, and fallback states against
  the deployed stack.

Exit check: automated checks pass and browser network inspection shows media
originating from Oracle Caddy, never from the home IP or Next.js route handler.

### 8. Compatibility and network testing

- Test WebRTC from at least two networks outside the home connection.
- Test Chrome, Firefox, Safari/iOS, and Android where available.
- Confirm UDP 8189 works and assess whether a TCP ICE listener or TURN is
  needed for restrictive networks.
- Test HLS fallback when WebRTC is intentionally blocked.
- Decide whether AV1-only viewing is acceptable for the friend group.
- If necessary, publish a separate H.264 compatibility path and configure
  `fallbackMediaPath`.

Exit check: each intended friend device either plays WebRTC or reaches the HLS
compatibility path with a clear user-facing result.

### 9. Operations and monitoring

- Enable bounded container logs and log rotation.
- Monitor VM disk, memory, CPU, outbound traffic, and container restarts.
- Create alerts before approaching the free-tier transfer limit.
- Back up only configuration and secrets metadata; do not back up transient HLS
  segments.
- Document how to rebuild the VM from a clean image.
- Schedule controlled upgrades for Caddy, MediaMTX, Node, and the base image.
- Test certificate renewal and a full VM reboot before the first shared stream.
- Keep a local export of secrets in an encrypted password manager.

Oracle may change free-tier terms or reclaim eligible idle resources. The
recovery plan must assume the VM can disappear and should require only a new VM,
the repository, and restored secrets.

## Acceptance criteria

The deployment is ready for friends when all of the following are true:

- OBS publishes one stream to Oracle using an outbound home connection only.
- No router port is forwarded to the home computer.
- Viewer connection details and WebRTC ICE candidates contain no home IP.
- Unauthenticated pages and direct media URLs are rejected.
- Publisher, reader, and Control API permissions are separated.
- Caddy is the only public HTTP service.
- The MediaMTX Control API is not publicly reachable.
- WebRTC works from an external network and HLS takes over when it does not.
- Stream start, stop, reconnect, and offline transitions have been exercised.
- Typecheck, lint, unit/component tests, production build, and E2E tests pass.
- Actual bitrate and viewer-hour estimates fit comfortably within the current
  Oracle allowance.
- A clean rebuild and secret-rotation procedure is documented.

## Rollback and fallback

- Keep the existing home deployment unchanged until Oracle passes all checks.
- Test Oracle with a temporary channel/path before switching the main OBS
  profile.
- Preserve the local OBS profile so publishing can be switched back quickly.
- If Oracle capacity or account stability is unacceptable, fall back to the
  home deployment with a private VPN for friends.
- If WebRTC is unreliable, keep Oracle and temporarily use authenticated HLS
  only; do not route video through Vercel as an accidental long-term fallback.

## Decisions selected for the first deployment

- Oracle Frankfurt (`eu-frankfurt-1`), Ampere A1 Flex, 1 OCPU and 6 GiB RAM.
- Reserved Oracle IPv4 with `frankerzspam.duckdns.org` for automatic TLS.
- Shared Caddy Basic Auth for viewers; username `gigachad`.
- Separate path-scoped MediaMTX publisher credential for OBS.
- Existing AV1/Opus feed with UDP WebRTC and HLS fallback.
- No TURN or TCP ICE until external testing demonstrates a need.
- Local log rotation first; Oracle usage alarms remain a follow-up.
