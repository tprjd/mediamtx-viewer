# Cache HLS viewing access for up to five seconds

Give each signed-in session a short, in-memory approval for one Channel's HLS media. This reduces repeated session and SQLite work while a viewer loads playlists, parts, and segments. Each viewer still receives the full video bitrate.

## Access rule

The current [account access guide](../../docs/account-access.md) requires a fresh approval check on every HLS and WHEP request. The proposed change permits the HLS server to authorize a new GET or HEAD request for up to five seconds after the last successful check. A request already in progress can finish, and a player can play media it has already received. Keep WHEP signaling, active WebRTC disconnections, and all other routes on their existing rules.

Choose a random lifetime of four to five seconds for each successful check. Measure it from the start of the check and cap it at the known session expiry. Hits never extend this deadline. On expiry, the next request makes the check. Concurrent requests for the same credential and media scope can share one check. If the check fails, use the route's normal denial or error response.

## Implementation

1. Establish a baseline through the production Caddy route in a local or staging deployment. Exercise five and ten independent signed-in sessions with real HLS requests. Record viewer-app CPU, request rate, and calls to session and Channel access checks.
2. Use one HLS decision path for [Caddy authorization](../../app/api/internal/authorize/route.ts) and the [direct media proxy](../../lib/media-proxy.ts). In the Caddy route, verify the internal secret and runtime configuration before any cache lookup. Use the original method and URI supplied by the trusted proxy. In the direct route, use the request's own method and URL.
3. Key each entry by a digest of the exact Cookie header and the validated HLS media directory. Bind the directory to the actual Channel media path on the first successful check. Distinguish the original path from a pilot derivative, including its source generation. Use the existing authorization path for any media layout that cannot be matched unambiguously. Keep playlist and part query parameters intact when forwarding media.
4. Use a bounded process-local map. Store only the identity fields the route already returns and the expiry. Expire or evict entries, bound concurrent checks, and keep credentials out of logs. A hit skips both the session lookup and the Channel permission lookup. A miss uses the existing session, account, and Channel access rules. Preserve response status, headers, and session-renewal behavior.
5. Update the account access guide when the behavior ships. The proposed five-second HLS rule covers loss of Channel approval, Account suspension, session revocation, and Channel disabling. Natural session expiry is a hard upper bound for a cached entry. Chat restrictions control posting and have no effect on this decision.

## Acceptance

- Both entry points serve successive authorized media requests without repeating the database-backed checks during the grant. WHEP and other routes continue to use their existing checks.
- Separate sessions, Channels, and derivative generations cannot share a decision. Malformed paths and missing or changed credentials get the same authorization result as the uncached path.
- Continuous traffic, parallel requests, a slow access check, and a pause followed by a retry all respect the absolute deadline. Failures after expiry cannot reuse the old grant. A restart begins with an empty cache.
- Repeat the baseline with the same workload. Report CPU per authorized request and full-check rate alongside playback stalls. Ten continuously active HLS sessions should need roughly two to two and a half successful full checks per second per process after warm-up. Benchmark the actual CPU savings before proposing production rollout.

## Implementation order

1. [Measure the current access path](issues/01-measure-hls-access.md)
2. [Implement and validate the bounded cache](issues/02-cache-hls-access.md)
