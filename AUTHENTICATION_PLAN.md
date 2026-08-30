# Account Authentication and Approval Plan

> Status: implemented and deployed. The account flow passed its live smoke
> test; the original Basic Auth Caddyfile remains available as an operational
> rollback file.

## Objective

Replace the shared browser password with individual accounts while preserving
the existing same-origin media architecture.

A friend should be able to register, but must not see the viewer or media until
an administrator activates the account. An administrator needs a private page
to review pending registrations, activate or disable users, and revoke their
sessions.

OBS publishing remains a separate machine credential. A website user account
must never grant permission to publish, and the OBS bearer token must never be
accepted as a website login.

## Selected architecture

Use these components for the first account-based release:

- Better Auth for credential handling, database sessions, CSRF protections,
  and the username and admin plugins.
- SQLite on the Oracle VM for users and sessions. One Next.js instance and a
  small friend group do not justify a separate PostgreSQL service yet.
- Caddy `forward_auth` for the public access boundary. Caddy asks the Next.js
  authorization endpoint to validate the session cookie before serving pages,
  APIs, HLS, or WHEP.
- The current internal MediaMTX reader permissions. Caddy removes website
  credentials before proxying media, and MediaMTX remains reachable only on
  the private Docker network.
- The existing path-scoped MediaMTX publisher credential for OBS, unchanged.

Do not use the hosted Better Auth Infrastructure dashboard. Authentication,
the database, and the admin UI should remain self-hosted on Oracle.

### Why Caddy must participate

Protecting only Next.js pages is insufficient. HLS manifests and segments, the
MediaMTX reader script, WHEP offers, and WHEP ICE session requests are served
directly by MediaMTX through Caddy.

With `forward_auth`, the browser sends one first-party, HTTP-only session cookie
to the public hostname. Caddy validates it through Next.js before routing the
request. This works with ordinary page navigation, hls.js, native HLS, and the
MediaMTX WebRTC reader without putting tokens in playback URLs.

```text
Browser
  │ Secure session cookie
  ▼
Caddy ── auth subrequest ──> Next.js /api/internal/authorize ──> SQLite
  │                                  │
  │ allowed                          └── active user/session check
  ├── page/API ────────────> Next.js
  ├── HLS/WHEP ────────────> MediaMTX
  └── WHIP publish ────────> MediaMTX (separate OBS bearer token)
```

## User experience

### Registration

1. The administrator temporarily enables registration on `/admin/users`.
2. A friend opens `/register` and supplies display name, username, email, and a
   password.
3. The account is created with `activationStatus = pending` and no session is
   issued.
4. The friend sees a neutral confirmation page explaining that approval is
   pending.
5. Registration can be closed again without affecting existing users.

Registration should default to closed after the first rollout. This prevents a
public hostname from accumulating bot registrations while still allowing the
administrator to open a short signup window for friends.

### Activation

1. `/admin/users` displays pending users first.
2. The administrator reviews the username, display name, email, and creation
   time.
3. Activating changes the account to `active` and records the administrator and
   timestamp in the audit log.
4. The friend can sign in immediately. Email notification is deferred; the
   administrator tells the friend directly in the initial version.

### Login and logout

- Users sign in with username and password.
- A pending user receives “Your account is waiting for approval.”
- A disabled user receives “This account is disabled.”
- Unknown users and wrong passwords receive the same generic error to reduce
  account enumeration.
- Successful login rotates the session identifier and redirects only to a
  validated same-origin `returnTo` path.
- Logout revokes the database session and expires the cookie.

### Administration

The admin page has three views: Pending, Active, and Disabled. It supports:

- Activate a pending or disabled account.
- Disable an account and revoke all of its website sessions.
- Reject and delete a pending registration after confirmation.
- View active sessions and revoke one or all sessions for a user.
- Generate a one-time password-reset link, shown only once and expiring after
  15 minutes. The administrator must not choose or learn the new password.
- Open or close registration.
- View a concise audit history for user-management actions.

The final active administrator cannot disable, delete, or demote their own
account. Sensitive actions require a fresh admin session or password
confirmation.

## Data model

Use Better Auth's core user, account, session, and verification tables, plus the
username and admin plugin fields. Extend them with server-owned approval data.

### User additions

| Field | Type | Purpose |
| --- | --- | --- |
| `activationStatus` | `pending | active | disabled` | Explicit account lifecycle; never writable by registration input |
| `activatedAt` | nullable timestamp | When approval last occurred |
| `activatedBy` | nullable user ID | Administrator that approved the account |
| `disabledAt` | nullable timestamp | When the account was disabled |

The Better Auth `role` remains `user` or `admin`. Role and activation status are
separate: an admin role grants management permissions, while activation status
decides whether any new session may be created or used.

### Additional tables

`site_setting`

- `key` primary key
- `value`
- `updatedAt`
- `updatedBy`

The first setting is `registration_open`, defaulting to `false`.

`auth_audit_log`

- random ID
- administrator user ID
- target user ID when applicable
- action such as `activate`, `disable`, `reject`, `revoke_sessions`, or
  `registration_opened`
- timestamp
- small JSON metadata object without secrets or full IP addresses

Audit rows are append-only from the application. Passwords, password hashes,
session tokens, OBS tokens, and complete request headers must never be logged.

## Better Auth configuration

- Pin a reviewed Better Auth release in `package-lock.json`; do not use a
  floating runtime version.
- Enable email/password, username, and admin plugins.
- Set `autoSignIn: false` so registration never creates an active session.
- Set a 15-character minimum and at least 64-character maximum password length;
  allow spaces and Unicode rather than imposing composition rules.
- Keep Better Auth's memory-hard scrypt password hashing initially. Argon2id is
  acceptable later only after verifying ARM native-module packaging and memory
  limits.
- Store sessions in SQLite. Do not enable stateless-only sessions.
- Disable session cookie caching initially so account disabling and session
  revocation are observed on the next authorization check.
- Use a seven-day session lifetime with daily rotation/refresh. Add an optional
  “remember me” duration only after the basic flow is stable.
- Set a generated `BETTER_AUTH_SECRET` of at least 32 random bytes and support
  versioned secret rotation.
- Set the only trusted production origin to
  `https://frankerzspam.duckdns.org`.
- Add a session-creation hook that loads the user and rejects any status other
  than `active`.
- Add a user-creation hook that sets public registrations to `pending`; clients
  cannot submit role or activation fields.
- Configure a reduced admin permission set. Do not expose impersonation in the
  initial UI.

The first admin is created through an SSH-only CLI command after migrations,
then explicitly marked `active`. There is no public “first user becomes admin”
flow and no permanent setup URL.

## Session cookie

The production cookie must be:

- Opaque and generated by the auth library.
- `Secure`.
- `HttpOnly`.
- `SameSite=Lax`.
- Scoped to `Path=/` and the current host only; do not set a broad Domain.
- Never copied to local storage, JavaScript state, playback URLs, logs, or
  MediaMTX.

Login, registration, reset, and admin mutations use POST requests with Better
Auth's origin/CSRF checks. Add rate limits to registration, login, and reset
requests. Rate-limit metadata should expire and should not become a permanent
record of viewer IP addresses.

## Application routes

Public routes:

- `/login`
- `/register` when registration is open; otherwise show a closed message
- `/registration-pending`
- `/api/auth/*` Better Auth endpoints, which still enforce their own admin
  authorization where applicable
- `/_next/*` and the minimal static assets needed to render auth pages

Authenticated user routes:

- `/`
- `/watch/*`
- `/api/channels/*`
- `/media/hls/*`
- `/media/whep/*`
- `/account`, logout, change-password, and session-management actions

Admin-only routes:

- `/admin/users`
- Server-side activation, disabling, rejection, reset-link, registration
  setting, and session-revocation actions

Internal-only route:

- `/api/internal/authorize`

The internal authorization route validates the Better Auth session directly
against the database and confirms `activationStatus = active`. Caddy calls it
over the private Docker network. Direct public requests to this path return
404, even when authenticated.

## Caddy changes

Replace `basic_auth` with `forward_auth` for every protected route. The auth
subrequest receives the original method and URI. It should return:

- `2xx` for an active session.
- A redirect to `/login?returnTo=...` only for top-level HTML navigation.
- `401` for APIs, HLS, WHEP, scripts, and other subresources so media clients do
  not receive an HTML login page.

Conceptual Caddy routing:

```caddyfile
@account_public path /login /register /registration-pending /api/auth/* /_next/*
@obs_publish path /publish/whep/*
@needs_user not path /login /register /registration-pending /api/auth/* /_next/* /publish/whep/*

forward_auth @needs_user viewer:3000 {
    uri /api/internal/authorize
}

# Existing handle_path routes remain. Website cookies and authorization
# headers are removed before HLS/WHEP requests reach MediaMTX.
```

The actual Caddyfile must retain the current WHIP/WHEP `Location` response
rewrites. WHEP session `PATCH` and `DELETE` requests need the same authorization
check as the initial WHEP request.

The OBS publish prefix bypasses website account auth, but MediaMTX continues to
require the restricted `publisher` bearer token. Ports 8888, 8889, and 9997
remain private.

## SQLite and container changes

- Store the database at `/data/auth.sqlite` in a dedicated named volume.
- Enable WAL mode and a busy timeout.
- Ensure the volume is writable by the unprivileged Next.js UID without making
  the container run as root.
- Run explicit, versioned migrations before starting the new application image.
  Never run destructive schema generation automatically on every boot.
- Include required SQLite native modules in the Next.js standalone image and
  test the final ARM64 image on Oracle.
- Add a readiness check that fails if migrations are missing or the database is
  not writable.
- Back up SQLite using its online backup mechanism, not a raw copy of a live WAL
  database. Encrypt backups and keep a short retention window.

Do not put the database in the image, repository, Caddy certificate volume, or
MediaMTX configuration volume.

## Deactivation semantics

Disabling a user revokes all of that user's database sessions immediately.
This blocks the next page, API, HLS segment, or WHEP signaling request.

An already-established WebRTC connection sends encrypted UDP media directly
between MediaMTX and the browser and does not consult Caddy for every packet.
Therefore it can continue until the peer disconnects unless explicitly kicked.

For the first release, the admin action should offer “disconnect current
viewers now.” It may close all current MediaMTX reader sessions on `live` through
the private Control API. Active users reconnect automatically; the disabled
user cannot create a new session. Per-user WebRTC termination is a later phase
that would require associating WHEP session IDs with authenticated user IDs.

This limitation must be shown in the admin confirmation rather than implying
that session revocation can recall an already-established UDP connection.

## Delivery phases

### 1. Auth foundation

- Add pinned Better Auth and SQLite dependencies.
- Define the schema, migrations, server-only database module, and auth config.
- Add account-status session hooks and strict environment validation.
- Add an SSH-only first-admin command.
- Add the persistent database volume and ARM64 image support.

Exit check: migrations work on a clean volume and restart without changing
existing rows; pending and disabled users cannot receive a session.

### 2. Registration and login UI

- Build accessible login, registration, pending, logout, password-change, and
  account-session pages.
- Validate all input on the server with Zod.
- Add generic error behavior, safe return paths, rate limits, and CSRF tests.
- Make registration-open state server-controlled and default closed.

Exit check: registration creates only pending users, login rotates the session,
and no credential or token appears in client JavaScript or URLs.

### 3. Admin UI

- Build pending, active, and disabled lists with search and clear empty states.
- Implement activation, disable/reactivate, reject, reset link, session revoke,
  and registration toggle actions.
- Require an admin role on every server action and route handler, not merely in
  the page UI.
- Add confirmations, last-admin protections, and audit rows.

Exit check: a normal user cannot call any admin operation directly, and every
successful administrative change has an audit entry.

### 4. Caddy and media integration

- Add `/api/internal/authorize` and switch Caddy from Basic Auth to
  `forward_auth` in a local integration environment.
- Preserve the existing HLS prefix, WHEP session-location rewrites, and OBS
  publish bypass.
- Strip website cookies and authorization headers before proxying to MediaMTX.
- Teach the WebRTC and HLS UI to display “Session expired” and link to login
  instead of entering an infinite retry loop on `401`.

Exit check: one login grants page, API, reader script, HLS, and WHEP access;
copying any direct media URL into a signed-out browser returns `401`.

### 5. Deployment and migration

- Back up the repository, current Caddyfile, and generated secrets.
- Deploy migrations and create the active admin while shared Basic Auth is
  still protecting the site.
- Run the full account flow locally or on a temporary test route.
- Switch Caddy to account auth during a short maintenance window.
- Log in as admin, activate one test user, and verify real OBS playback.
- Remove the shared viewer bcrypt hash only after rollback testing.

Rollback restores the previous Caddy Basic Auth configuration and restarts
Caddy. The SQLite volume stays intact for another attempt; rollback must not
delete accounts or migrations.

## Required tests

Unit and integration tests:

- Account state transitions and invalid transitions.
- Session-creation rejection for pending and disabled users.
- Admin role enforcement on every mutation.
- Last-admin protection.
- Safe `returnTo` validation and generic login errors.
- Registration toggle and rate limits.
- Session revocation and expiration.
- Caddy authorization responses for document versus media requests.
- Audit-log redaction.

Playwright flows on desktop and mobile:

1. Register, see pending state, and fail to access viewer/media.
2. Admin logs in and activates the account.
3. User logs in once and watches WebRTC without extra prompts or retry loops.
4. HLS fallback continues using the same cookie.
5. Direct media URLs fail in a signed-out context.
6. Disabling the user revokes sessions and blocks new WHEP/HLS requests.
7. OBS remains publishing throughout user activation and deactivation.
8. A normal user cannot load or invoke admin functionality.

Security and operations checks:

- No auth database, session token, password hash, reset token, or backup is
  tracked by Git or included in a Docker image layer.
- Cookies have the intended production flags.
- Login and registration throttling works behind Caddy without trusting spoofed
  forwarding headers.
- Database backup and restore are exercised on a disposable volume.
- VM reboot preserves accounts and invalidates nothing unexpectedly.

## Acceptance criteria

The shared Basic Auth can be retired when all of these are true:

- New registrations are pending and cannot log in or fetch media.
- Only an active administrator can activate or disable users.
- Activated users need one website login and receive no additional playback
  prompt.
- Deactivation revokes all website sessions and has documented behavior for an
  already-established WebRTC connection.
- Page, API, HLS, WHEP, and WHEP session URLs share one access boundary.
- OBS publishing remains separate and works without a website session.
- Admin actions are authorized server-side and audited without sensitive data.
- SQLite persists across deploys and has a tested encrypted backup/restore path.
- Typecheck, lint, unit/component tests, production build, Compose validation,
  and Playwright flows pass on the production architecture.

## Decisions applied

Recommended defaults are shown first:

- Collect email plus username, but use username for login. Email delivery and
  verification can be added later; initially it supports identification and a
  future reset flow.
- Registration closed by default, opened temporarily from the admin page.
- Seven-day database sessions with no cookie cache.
- Admin-generated one-time reset links rather than administrators setting user
  passwords.
- Disconnect all current readers when immediately disabling someone; otherwise
  an established WebRTC connection ends naturally.
- Keep SQLite until multiple application replicas or materially higher traffic
  require PostgreSQL.

The initial administrator is provisioned from an ignored deployment secret,
and registration collects an email address plus username for the friend group.

## Primary references

- Next.js authentication guide:
  <https://nextjs.org/docs/app/guides/authentication>
- Caddy `forward_auth`:
  <https://caddyserver.com/docs/caddyfile/directives/forward_auth>
- Better Auth sessions:
  <https://better-auth.com/docs/concepts/session-management>
- Better Auth admin plugin:
  <https://better-auth.com/docs/plugins/admin>
- Better Auth username plugin:
  <https://better-auth.com/docs/plugins/username>
- MediaMTX authentication:
  <https://mediamtx.org/docs/features/authentication>
- OWASP authentication and password-storage guidance:
  <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
  and
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
