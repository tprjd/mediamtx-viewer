# Account access and notifications

Available in version 2.0.0. This release changes registration and account access.
Deploy the viewer and its matching proxy configuration together. Configure SMTP
and test email delivery before production activation.

The [design spec](../.scratch/open-registration/spec.md) records the interview, implementation boundaries, and verification plan.
The [domain glossary](../CONTEXT.md) defines the canonical terms.

## Registration and account states

Registration replaces the account request-access flow. New accounts can sign in without Administrator approval.
Registration creates one Channel for each account, including accounts created through Google or Discord.
The owner can manage the Channel before publishing.

Administrator approval grants Viewing access to all channels. It does not grant an administrator role.
Account suspension is separate. A suspended account cannot use the account or publish, regardless of stored approvals.
Withholding or removing Administrator approval does not suspend or delete the account.

New password accounts must verify their email before publishing or submitting a Viewing request.
Provider registration already requires an email verified by the provider.
A new account's Channel stays hidden from other accounts until email verification completes.
The owner can still open its management page.

Existing accounts keep their current access through the transition without being falsely marked email-verified.
Existing password accounts must verify their email while signed in before using email password recovery.

## Viewing access

For an account that is not suspended, any of these conditions grants Viewing access:

- The account owns the Channel.
- The account has Administrator approval.
- The account has stored Channel approval from that Channel's owner.

Channel approval belongs to one account and one Channel. It persists across visits, sign-out, and stream restarts.
It does not depend on a browser session or a display name.

An owner can revoke Channel approval. Administrator approval continues to grant Viewing access regardless of the owner's decision.
Removing Administrator approval preserves stored Channel approvals. Other channels require a new Viewing request.

| Account relationship to a Channel | Watch and see thumbnails | Read and send live chat | Moderate chat |
| --- | --- | --- | --- |
| Owner, without Administrator approval | Yes | Yes | Yes, under existing owner rules |
| Account with Channel approval | Yes | Yes, subject to Chat restrictions | No, unless separately authorized |
| Account with Administrator approval | Yes | Yes, subject to Chat restrictions | Only with the administrator role or existing moderator authority |
| Account without any Viewing access | No | No | No |
| Suspended account | No | No | No |

Existing Chat restrictions continue to affect message sending without removing Viewing access.
Existing live-channel and Chat availability rules still apply.

## Viewing requests and owner decisions

An account without Viewing access selects **Request to watch** on the restricted channel page.
Opening or refreshing the page does not send a request.
Each account can have one pending Viewing request per Channel. Duplicate submissions do not create duplicate notifications.

The owner receives a notification for each new accepted Viewing request.
The owner can approve or reject the request from the header notification center or the channel page.
The channel page also lists stored Channel approvals and permits revocation.

After rejection or revocation, the viewer can submit another request after 30 minutes.
The delay does not create a request automatically. The viewer must select **Request to watch** again.

Administrator approval closes pending Viewing requests as no longer needed.
Removing Administrator approval does not reopen those requests.
A stale notification action cannot reopen a completed request or restore revoked approval.

## Restricted channels

Accounts without Viewing access can see a channel's name, owner, live status, and a generic locked image.
They cannot see channel thumbnails, play media, or read chat.

The same rules apply to the channel directory, watch page, live navigation, and channel updates.
Direct thumbnail, HLS, WebRTC, and Chat requests must enforce the same Viewing access decision.
The app must not send a restricted thumbnail URL and rely on visual blur to conceal it.

The rule that hides new unverified accounts' channels applies before this restricted-channel display rule.

### Channel read module

`lib/channel-reads.ts` owns account-specific Channel reads and field filtering for
the directory, public live updates, periodic directory refreshes, and status
replies. It uses the Viewing access rules in `lib/viewing-access.ts`. Route
adapters handle sessions, response encoding, and connection lifetime.

The shared status monitor keeps account-neutral data. The read module checks
current access for each public delivery without changing the shared event.
Internal subscribers, including the Discord notifier, keep the original data.
Direct thumbnail, media, and Chat requests still check Viewing access separately.

These paths retain their existing response fields and Channel selection rules.
Periodic directory events contain full Channel data; monitor events contain
partial updates. An owner's disabled Channel can appear in the directory, while
its status request returns 404 and the shared monitor omits it. The module
preserves this difference; it does not define a new access policy.

## Notification center and sound

This version delivers notifications inside the app. It does not add browser or desktop notifications outside the app.
The header shows unread notifications and request actions.
Reading a notification does not approve, reject, or remove the underlying Viewing request.

Notifications persist while an account is signed out or the app is closed.
Owners receive Viewing requests. Viewers receive the approval or rejection result.
The center shows stored notifications when the account returns.

Notification sound starts enabled. The channel page contains an account-level sound setting that persists across devices.
This setting applies to all in-app notifications for that account.
Disabling sound never disables notification delivery.
Old notifications do not play sounds when the account returns.

The existing Discord go-live notification setting remains separate because it controls delivery to Discord.

## Password recovery and email

The login screen provides **Forgot password**.
Password accounts with verified email can request a recovery link by email.
Existing password accounts with unverified email must complete verification while signed in before using this recovery path.
Administrator-generated reset links remain available as a fallback.

Accounts with only Google or Discord sign-in use their provider's recovery process.
Email recovery must not silently create a local password for a provider-only account.
Existing reset behavior includes single-use links, a 15-minute expiry, and session revocation after a successful reset.

Verification and recovery emails use configurable SMTP delivery.
A mail service and sender address have not been selected.
SMTP credentials and the sender address must be configured before deployment of the new registration flow.

## Existing account and channel transition

| Existing state | New state |
| --- | --- |
| Active | Can sign in and has Administrator approval |
| Pending | Can sign in without Administrator approval |
| Disabled | Remains suspended |

Existing channels remain attached to their owners.
Each non-suspended account without a Channel receives one during migration.
The migration records existing password accounts separately from their email verification state.
It must not mark an address verified without proof.

Suspension keeps the existing behavior that disables publishing and removes stream keys.
The old registration-rejection action must not delete an account merely because it lacks Administrator approval.

## Decision rationale

Administrator approval and Account suspension are separate because new accounts must be able to participate before gaining global Viewing access.
Channel owners can grant local access without taking responsibility for access to other channels.

Channel approvals persist because approval is for an account, not a single viewing session.
The 30-minute retry delay limits repeated requests while allowing a viewer to ask again.

The existing-account exception preserves current access during rollout.
Requiring verification before email recovery prevents an unverified stored address from becoming a new password-reset authority.

Stored notifications preserve requests while owners are absent.
A separate sound preference lets owners mute interruptions without missing requests.

## Interface decision

Variant A supplies the new access flow. Keep the existing header, channel navigation,
channel cards, player controls, account settings, and administration layout.
Add the notification button to the header and the viewing-request and sound sections
to the existing channel page. Keep OBS publishing, stream-key management, Discord
notifications, and broadcast controls.

## Setup and migration

Run `npm run auth:migrate` before starting the updated server. Migration 007 records
legacy access, separates administrator approval from suspension, and creates missing
channels. Registration and automatic channel creation use one database transaction.
The database still uses `activationStatus = active` for account use and `disabled`
for suspension. `administratorApproved` is the separate viewing approval flag.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and, when the server requires
credentials, `SMTP_USER` and `SMTP_PASSWORD`. Set `SMTP_SECURE=true` for implicit TLS
on port 465. STARTTLS is required by default on other ports. Use
`SMTP_REQUIRE_TLS=false` only for a local mail receiver. Compose forwards these
settings to the viewer. Verification links expire after 60 minutes; reset links
expire after 15 minutes. Both are single-use. Delivery requests are rate limited.

Deploy the updated Centrifugo configuration with the viewer. Chat uses its
[connect and refresh proxy](https://centrifugal.dev/docs/server/proxy) to check
current channel approval and the original sign-in session. Session expiry or
revocation disconnects the client at its next refresh. A signed connection credential alone does not grant a
subscription. This prevents reconnecting with a credential issued before revocation.
Centrifugo must have no direct JWT authentication secret configured. The viewer
still uses `CENTRIFUGO_TOKEN_HMAC_SECRET` to sign its short-lived connection credentials.

Revocations queue WebRTC and chat disconnections durably and retry service failures.
MediaMTX does not map readers to site accounts, so revocation reconnects the affected
channel's WebRTC readers. Removing global approval reconnects all WebRTC readers.
Each transport records completion separately, so a Chat outage does not repeat
completed video disconnections or block later video revocations.
Publishers stay connected. HLS and WHEP HTTP requests check current approval on each
request, including direct requests to the viewer server.

`lib/account-restrictions.ts` owns completion of Account suspension and Channel
disabling. The administrator actions check authorization and select notices and
redirects. The module commits the existing database transaction before it attempts
disconnections. It reports Chat and media completion separately. A failed
disconnection leaves the stored restriction active, and a Chat failure does not
prevent the media attempt.

Account suspension also leaves its durable revocation pending for the dispatcher
to disconnect Chat and all WebRTC readers. The immediate attempt disconnects
WebRTC readers and Publishers on the owned Channel. Channel disabling only makes
that immediate media attempt; it does not queue retries or disconnect Chat.
Neither operation explicitly disconnects an active RTMP Publisher. Enabling a
Channel does not disconnect sessions or create a replacement stream key.

The notification center checks for new notifications every five seconds. Browser
sound requires a prior user interaction. A browser lock and a shared notification
watermark prevent duplicate sounds across tabs. Muting sound leaves delivery enabled.

`lib/notification-inbox.ts` owns the Notification inbox state, polling, history
cursor, read actions, Viewing request decisions, and sound eligibility. Its
`useNotificationInbox` interface gives the header view the current state and the
`markRead`, `decide`, and `loadOlder` actions.
It rejects responses that started before a read or decision action. Polling waits
while that action completes. A delayed history response cannot replace a newer
history cursor. Closing the page cancels outstanding reads and discards late
responses and queued sounds.

The public WHIP prefix accepts only publishing endpoints and their session URLs.
RTMP reads are rejected; RTMP remains available for publishing. Private RTSP reads
remain available to the thumbnail worker. The MediaMTX authorization callback uses
the [protocol field](https://mediamtx.org/docs/features/authentication) to enforce
this distinction.
