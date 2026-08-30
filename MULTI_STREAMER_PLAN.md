# Account-Owned Channel Plan

> Status: implemented and deployed on 2026-08-30.
>
> Recommended scope: one channel per approved streamer, multiple channels live
> at the same time, OBS/WHIP publishing, and viewing restricted to active site
> accounts.

## Release status

The application, database migration, MediaMTX HTTP authorization, Caddy routes,
streamer/admin interfaces, automated tests, and Oracle deployment are complete.
The existing administrator owns `live`, so `/watch/live` remains stable. A new
one-time stream key must be generated from `/account/channel`; the former shared
publisher credential is no longer accepted.

Verified locally and against the deployed service:

- SQLite migration `003_account_owned_channels.sql` applied successfully.
- Production build, type checking, linting, 28 integration/unit tests, and 12
  desktop/mobile Playwright tests pass.
- MediaMTX 1.20.1 accepts the dynamic-path configuration and calls the private
  authorization endpoint.
- The Oracle containers are healthy, the authenticated channel/API pages work,
  signed-out playback is rejected, and an invalid OBS bearer token is rejected.
- Automated integration coverage proves two distinct stream keys can authorize
  their own paths concurrently and cannot cross-publish.

The only outstanding acceptance exercise is a real media/load test with two OBS
machines publishing simultaneously and authenticated viewers watching both.
OBS was offline during deployment, so this requires the streamers. Until that
passes, the legacy `/publish/whep/*` compatibility route and rollback notes stay
in place.

## Objective

Extend the friend-group viewer so selected registered users can broadcast from
OBS to their own channel at the same time.

An active website account remains a viewer by default. An administrator grants
streaming access separately. Each streamer receives a dedicated channel and a
random, revocable OBS stream key. Website passwords and browser sessions must
never be accepted as publishing credentials.

## Recommended product decisions

The implementation below assumes:

- Streaming is granted by an administrator; activating a viewer does not
  automatically allow broadcasting.
- Each streamer owns one channel.
- The public channel slug is chosen when streaming is granted and remains
  immutable. The streamer can edit the title and description.
- Every active account can watch every enabled channel. Per-channel invitations
  and public anonymous channels are outside this release.
- The streamer can generate or rotate their own stream key. Rotation immediately
  disconnects the existing publisher.
- OBS continues publishing with WHIP. RTMP, recording, transcoding, chat, and
  browser-based broadcasting remain out of scope.
- A second publisher for the same channel is rejected instead of replacing the
  first one.
- The existing `live` channel becomes the initial administrator's channel and
  keeps `/watch/live` working.

The product decisions at the end were confirmed before implementation.

## Current state and gap

The viewer already supports a channel directory, `/watch/[slug]`, per-channel
status, WebRTC playback, and HLS fallback. However:

- Channel metadata comes from `config/channels.json` at build time.
- The deployed MediaMTX configuration permits one publisher on path `live`.
- All active registered users are viewers; no streaming capability exists.
- The OBS credential is a shared deployment secret.
- Adding a channel currently requires editing configuration and redeploying.

The multi-streamer release moves channel ownership and publishing authorization
into SQLite. MediaMTX remains the media router and does not transcode video.

## Target architecture

```text
OBS A -- WHIP + stream key --> Caddy --> MediaMTX path channels/alice
                                           |
                                           +-- publish auth request --> Next.js
                                                                     |
                                                                     +--> SQLite

OBS B -- WHIP + stream key --> Caddy --> MediaMTX path channels/bob

Viewer -- site session --> Caddy -- forward_auth --> Next.js
                         |
                         +--> WHEP/HLS --> MediaMTX selected path
```

There are two deliberately separate access boundaries:

1. Caddy and Better Auth validate browser sessions for pages and playback.
2. MediaMTX asks a private Next.js endpoint to validate OBS publish credentials
   for the exact channel path.

Possession of a browser session does not allow publishing. Possession of a
stream key does not allow website login or viewing.

## Data model

Add a versioned SQLite migration with two new tables.

### `channel`

- `id`: random application identifier, primary key.
- `owner_user_id`: unique foreign key to `user`; enforces one channel per user.
- `slug`: case-insensitive unique, validated kebab-case value used by
  `/watch/[slug]`.
- `media_path`: unique immutable MediaMTX path, initially `channels/<slug>`.
- `display_name`: defaults to the account display name.
- `title`, `description`, `accent_color`, `preferred_playback`: current channel
  presentation fields.
- `enabled`: controls whether the channel appears and whether publishing is
  authorized.
- `created_at`, `updated_at`, `created_by`: lifecycle and audit fields.

Poster uploads remain out of scope. A future poster field can hold a trusted
URL after an upload/storage design exists.

### `channel_stream_key`

- `channel_id`: primary key and foreign key to `channel`.
- `token_hash`: unique SHA-256 hash of a random 256-bit key.
- `token_hint`: non-sensitive final characters shown to identify the current
  key.
- `created_at`, `rotated_at`: lifecycle timestamps.

The plaintext key is returned once when generated or rotated and is never
stored in SQLite, logs, audit metadata, backups, or browser storage. A key uses
a recognizable prefix such as `mtx_sk_` followed by random base64url data.
SHA-256 is suitable here because the input has 256 bits of generated entropy;
password hashing is neither necessary nor desirable for this token lookup.

Existing `auth_audit_log` records these new actions:

- `streaming_granted`
- `streaming_disabled`
- `stream_key_created`
- `stream_key_rotated`
- `publisher_disconnected`
- `channel_metadata_updated`

Audit metadata may contain a channel ID or slug, but never a token or hash.

## Publishing authorization

### MediaMTX configuration

Replace the single internal publisher account with MediaMTX HTTP
authentication for publishing:

```yaml
authMethod: http
authHTTPAddress: http://viewer:3000/api/internal/mediamtx/authorize?secret=...
authHTTPExclude:
  - action: read
  - action: playback
  - action: api

paths:
  "~^channels/[a-z0-9]+(?:-[a-z0-9]+)*$":
    source: publisher
    overridePublisher: false
```

The exact syntax must be validated against the pinned MediaMTX image during
implementation. MediaMTX 1.20.1 supports HTTP authentication, per-request
`action` and `path` values, bearer tokens from OBS, regular-expression paths,
and multiple simultaneous paths.

Read, playback, and Control API requests remain excluded from MediaMTX HTTP
authentication because those listeners are private Docker services. Playback
continues to be protected by Caddy `forward_auth`, and the Control API remains
reachable only inside the Docker network.

### Internal authorization endpoint

Add `POST /api/internal/mediamtx/authorize` to Next.js. It is called directly
over the private Docker network, not through the public Caddy route.

For a publish request it must:

1. Reject malformed bodies and all actions other than `publish`.
2. Validate the internal callback secret without logging it.
3. Hash the supplied bearer token.
4. Find the matching stream-key row using the indexed hash.
5. Require the owning user to have `activationStatus = active`.
6. Require the channel to be enabled.
7. Require the requested MediaMTX path to exactly match the channel's immutable
   `media_path`.
8. Return a 2xx response only when every check passes; otherwise return 401 or
   404 with a generic body.

Comparisons involving token material use timing-safe comparison where
applicable. The endpoint must not echo credentials and its tests must verify
that tokens cannot be replayed against another user's path.

### Caddy publishing route

Introduce the clearer external prefix `/publish/whip/*` and proxy it to the
MediaMTX WebRTC listener. The route remains outside browser `forward_auth`
because OBS authenticates with its bearer token.

Caddy must:

- Preserve the OBS `Authorization: Bearer` header.
- Remove cookies before proxying.
- Preserve WHIP session `Location` rewrites for POST/PATCH/DELETE requests.
- Never forward stream keys to Next.js page routes or application logs.
- Keep the current `/publish/whep/*` prefix temporarily during migration, then
  remove it after the existing OBS profile has been updated.

The OBS configuration presented to a streamer is:

```text
Service: WHIP
Server: https://frankerzspam.duckdns.org/publish/whip/channels/<slug>/whip
Bearer token: <one-time stream key>
```

## Application changes

### Dynamic channel repository

Replace build-time reads of `config/channels.json` with a database repository:

- `listEnabledChannels()` returns channels owned by active users.
- `getChannelBySlug()` returns one enabled channel for watch pages.
- `getOwnedChannel()` powers the streamer's account page.
- Admin queries may include disabled channels and inactive owners.

Fetch the MediaMTX path list once and map statuses to channels instead of making
one Control API request per channel. This avoids an N+1 request pattern as the
friend group grows.

The existing Zod schemas remain the validation boundary for public channel
objects, with database-row mapping added behind them.

### Streamer account page

Add `/account/channel` for an active user who has been granted streaming:

- Channel status: enabled/disabled and live/offline.
- OBS server URL with a copy button.
- Generate-key state when no key exists.
- One-time stream-key reveal after creation or rotation.
- Explicit confirmation before rotation.
- A “Disconnect current broadcast” action.
- Editable title and description with strict length validation.
- Codec guidance: H.264 plus Opus for broad WebRTC compatibility, with the
  currently supported OBS profile documented separately.

The page must explain that closing it loses the displayed plaintext key and a
new key will be required if it was not copied.

### Administrator controls

Extend the admin area or add `/admin/channels` with:

- Grant streaming access to an active account.
- Choose and validate an immutable channel slug.
- Enable or disable a channel.
- Rotate/revoke a stream key without seeing its plaintext.
- Disconnect the current publisher.
- See live/offline status and the current key hint.

Disabling a website account must atomically disable its channel, revoke its
stream key, revoke website sessions, and request disconnection of its active
publisher and readers. Database state is authoritative even if the MediaMTX
disconnect call temporarily fails; a retryable operational warning should be
shown to the administrator.

### Channel directory and watch pages

- Render channel metadata from SQLite.
- Include only enabled channels whose owners are active.
- Continue showing offline channels.
- Preserve `/watch/live` for the existing channel.
- Poll status by slug as today, resolving the slug to the immutable media path
  server-side.
- Never expose stream-key state in public channel API responses.

## Lifecycle rules

### Grant streaming

1. Admin selects an active user and chooses a unique slug.
2. The application creates the channel; no key is created yet.
3. The streamer visits `/account/channel` and generates the key.
4. The key is shown once with OBS instructions.

### Rotate a key

1. Generate a replacement key and update its hash transactionally.
2. Record an audit event without secret material.
3. Kick the currently publishing WebRTC session for that media path.
4. Reveal the new key once.

The database change succeeds even if MediaMTX is temporarily unavailable. The
old key stops authorizing new sessions immediately; the UI reports whether the
active-session disconnect also succeeded.

### Disable streaming or account

- Disable authorization before attempting any MediaMTX API call.
- Revoke the key.
- Kick the active publisher and current readers for the path.
- Keep the channel row for auditability and possible re-enablement.
- Re-enabling requires generation of a new key.

### Concurrent publishing

Different channels may publish simultaneously. Only one publisher is allowed
per channel. A second connection to an already-live channel must fail rather
than replace the existing source.

## Security requirements

- Website passwords and Better Auth session tokens are never sent to MediaMTX.
- Stream keys authorize only `publish` on one exact path.
- Stream keys are high-entropy, stored only as hashes, and displayed once.
- Publishing is denied for pending, disabled, or deleted owners.
- Channel ownership and admin privileges are checked in server actions, not
  only hidden in the interface.
- Internal authorization failures use generic responses and do not disclose
  whether a slug, account, or key exists.
- Caddy strips cookies from both publishing and playback proxy requests.
- SQLite and encrypted backups remain on the persistent auth volume.
- Tokens, hashes, callback secrets, and request authorization headers are
  excluded from structured logs and audit metadata.
- All admin and self-service mutations receive CSRF protection through the
  existing authenticated server-action boundary.

## Capacity and free-tier guardrails

MediaMTX routes encoded packets and does not transcode, so OBS machines carry
the encoding cost. The current 1 OCPU/6 GB Oracle A1 VM should be tested rather
than assumed to support an unlimited number of encrypted WebRTC connections.

Initial operational limits:

- One channel per streamer.
- Suggested maximum OBS bitrate of 6 Mbps.
- No server-side recording or transcoding.
- Target validation: at least two simultaneous 1080p publishers with two
  authenticated viewers on each channel.
- Monitor CPU, memory, outbound bandwidth, WebRTC packet loss, and discarded
  frames during the load test.

Outbound traffic remains the likely free-tier constraint: every viewer receives
a separate copy of their selected stream. At 6 Mbps, each viewer-hour is about
2.7 GB before overhead.

## Migration and rollout

### Phase 1: schema and domain layer

1. Add the channel and stream-key migration.
2. Add validation, repository functions, token generation, hashing, and audit
   events.
3. Add the initial administrator-owned `live` channel through an idempotent
   migration/bootstrap script.
4. Keep `config/channels.json` as a temporary fallback during this phase.

### Phase 2: application and admin UI

1. Move directory, watch, and status APIs to SQLite-backed channels.
2. Add admin streaming grant/disable controls.
3. Add `/account/channel`, metadata editing, OBS instructions, and one-time key
   display.
4. Remove the static JSON fallback after parity tests pass.

### Phase 3: MediaMTX publish authorization

1. Add the private MediaMTX authorization endpoint and its integration tests.
2. Add the callback secret to ignored deployment configuration.
3. Switch MediaMTX from the single internal publisher to HTTP authorization and
   dynamic channel paths.
4. Add the new Caddy `/publish/whip/*` route while retaining the legacy route.
5. Generate a new key for the existing `live` channel and update the current OBS
   profile.

### Phase 4: live validation

1. Broadcast on `live` and a second test account simultaneously.
2. Watch both channels from separate authenticated sessions.
3. Verify WebRTC and HLS playback, directory state changes, and offline recovery.
4. Attempt cross-path publishing, revoked keys, viewer-only publishing, and a
   second publisher on one channel.
5. Disable a live streamer and verify both authorization revocation and active
   disconnection.
6. Run the target load test and review VM/network metrics.

### Phase 5: cleanup

1. Remove the legacy shared publisher credentials and old Caddy publish prefix.
2. Remove the static channel configuration.
3. Update deployment, backup/restore, user, and OBS documentation.
4. Retain a rollback MediaMTX/Caddy configuration until the multi-stream live
   smoke test passes.

## Testing plan

Unit and integration tests must cover:

- Channel slug, path, title, and description validation.
- Unique owner, slug, media path, and stream-key hash constraints.
- One-time random key generation and hash verification.
- Correct-key/correct-path authorization.
- Correct-key/wrong-path rejection.
- Viewer-only, pending, disabled, deleted, or channel-disabled rejection.
- Old-key rejection immediately after rotation.
- Admin-only grant/disable operations and owner-only self-service operations.
- Audit entries contain no key, hash, callback secret, or authorization header.
- Directory and status APIs expose no private publishing fields.
- Account deactivation revokes both web and publishing access.
- MediaMTX-unavailable behavior leaves secure database state in effect.

Playwright and deployment checks must cover:

- Admin grants a second user streaming access.
- The streamer generates a key and sees OBS instructions once.
- Two publishers are live on separate paths at the same time.
- Two authenticated browser sessions can switch between both channels.
- A normal viewer cannot access streamer or admin actions.
- Key rotation disconnects the old publisher and permits the replacement key.
- VM/container restart preserves channels and key hashes.
- Encrypted backup/restore preserves channel ownership and authorization.

## Acceptance criteria

The release is complete when:

- Two approved streamers can publish concurrently to distinct owned channels.
- Each channel has a stable watch URL and appears dynamically in the directory.
- A stream key can publish only to its assigned channel.
- Active viewers cannot publish unless an administrator separately grants it.
- Website credentials cannot be used as stream credentials and vice versa.
- Keys are shown once, stored only as hashes, and revocable without redeploying.
- Disabling an account or channel rejects new publishing immediately and ends
  the active broadcast.
- One channel cannot silently replace another channel's publisher.
- WebRTC and HLS playback continue to use the website session boundary.
- The existing `live` URL is migrated without losing the administrator account.
- Tests, backup/restore, production build, Compose validation, and a two-stream
  Oracle smoke test pass.

## Confirmed decisions

1. Should every activated account receive a channel automatically, or should an
   admin grant streaming separately? Recommended: grant separately.
2. Should all active users be able to watch all channels, or do channels need
   per-user invitations/private access? Recommended: all active users can watch.
3. Should streamers edit their title and description themselves? Recommended:
   yes, while the slug remains admin-controlled and immutable.
4. Should the current `live` channel belong to the initial administrator
   account? Recommended: yes, preserving `/watch/live`.

## Primary references

- MediaMTX authentication:
  <https://mediamtx.org/docs/features/authentication>
- MediaMTX OBS/WHIP publishing:
  <https://mediamtx.org/docs/publish/obs-studio>
- MediaMTX configuration reference:
  <https://mediamtx.org/docs/references/configuration-file>
- MediaMTX Control API:
  <https://mediamtx.org/docs/features/control-api>
- Existing account authentication plan: `AUTHENTICATION_PLAN.md`
