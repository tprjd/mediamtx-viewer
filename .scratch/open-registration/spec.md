# Open registration and channel viewing approval

Status: implemented on 2026-10-04; local checks and SMTP delivery pass; final branch CI pending

## Requested behavior

- Anyone can register an account. Replace the account request-access flow with registration.
- A new account can choose to stream without administrator approval.
- An account without administrator approval needs the channel owner's approval to watch that channel.
- Store the channel owner's approval so the account does not need approval for each visit.
- Administrator approval removes the need for individual channel approvals.
- A channel owner receives a notification when an account requests permission to watch.
- Put a notification center in the header. Play a sound when a notification arrives.
- Let the channel owner disable notification sounds from the channel page. Notifications still arrive when sound is disabled.
- Add a forgot-password action to the login screen.
- Conceal channel thumbnails from accounts that lack permission to watch that channel.

## Accepted decisions

- New accounts can sign in and stream without administrator approval.
- Administrator approval grants viewing access to all channels.
- Account suspension is separate from administrator approval and blocks account use, including publishing.
- The glossary now distinguishes Administrator approval from Account suspension.
- A viewer selects **Request to watch** to send a Viewing request.
- Keep one pending Viewing request per account and channel. Repeat visits do not create duplicate notifications.
- Channel approval persists across visits and stream restarts.
- A channel owner can revoke Channel approval. Administrator approval still grants access to every channel, regardless of the owner's decision.
- Restricted channels remain visible with their name, owner, live status, and a generic locked image.
- Accounts without Viewing access cannot read chat, play media, or retrieve channel thumbnails, including through direct URLs.
- Store notifications for owners and viewers, including while they are signed out.
- Notify owners about Viewing requests and viewers about approval or rejection.
- Notification sound starts enabled. Muting sound does not disable notification delivery.
- Do not play sounds for old notifications when someone returns.
- New password accounts must verify their email before publishing or requesting Viewing access.
- Use email links for forgotten-password recovery. Provider-only accounts use their provider's recovery process.
- Preserve existing password accounts' current access during the transition. Do not mark their email addresses as verified without verification.
- The new email verification requirement applies to new accounts.
- Existing password accounts must verify their email while signed in before they can use email password recovery.
- Retain administrator-generated password reset links as a fallback for existing accounts without verified email.
- Deliver verification and recovery emails through configurable SMTP. Configure a mail service and sender address before deployment.
- This version uses in-app notifications only. Store notifications while the app is closed and show them when the account returns.
- After rejection or revocation of Channel approval, the account can send another Viewing request after 30 minutes.
- Removing Administrator approval preserves stored Channel approvals. Channels without a stored approval require a new request.
- Registration creates one Channel automatically for the new account.
- A Channel owner can watch and moderate their own channel without Administrator approval.
- Accounts with Channel approval can read and send chat, subject to existing Chat restrictions.
- Migrate active accounts to Administrator approval, pending accounts to signed-in eligibility without Administrator approval, and disabled accounts to Account suspension.
- Preserve existing channels. Create a channel for each non-suspended account that does not already own one.

## Existing implementation conflict

The implementation ties Viewing access and Streaming access to an account's active status.
The accepted model separates permission to use an account from administrator approval to watch all channels.
The glossary describes the accepted model. The implementation still uses the previous rules.

The repository keeps accepted decisions in maintained guides. Follow that convention instead of adding duplicate ADRs.

## Current implementation facts

- Pending accounts cannot sign in. The session creation check is in `lib/auth/auth.ts`.
- Viewing requires active status in `lib/auth/session.ts` and the media proxy authorization checks.
- Publishing and OBS setup also require active status in `lib/channels.ts` and `lib/obs-setup.ts`.
- Channel approval must protect direct HLS and WebRTC media requests, as well as pages and thumbnail requests.
- Password recovery currently uses administrator-generated, single-use links that expire after 15 minutes.
  See `app/admin/users/actions.ts`, `lib/auth/store.ts`, and `app/reset-password/actions.ts`.
- Local password accounts have no email verification flow. No recovery email sender is configured in `lib/auth/auth.ts`.
- The channel page has a setting for outbound Discord notifications when a channel goes live.
  That setting controls delivery. The proposed setting controls notification sound.
- The header has no notification center.
- `rejectPendingUser` in `lib/auth/store.ts` deletes the account. The new model permits unapproved accounts to own channels, so this registration-rejection action must be removed from that workflow.

## Implementation boundaries

- Separate signed-in eligibility, Administrator approval, Account suspension, and Channel approval in the authorization model.
- Use the same Viewing access decision for pages, channel APIs, thumbnails, HLS, WebRTC, and chat access.
- Keep chat restrictions independent from Viewing access. A chat ban must not remove permission to watch.
- Preserve existing account-linking rules except where they depend on the old active-only session requirement.
- Create an account and its channel consistently. Registration retries must not create multiple channels.
- Keep stored approvals tied to account and channel identity, rather than names or browser sessions.
- Record the existing-account email-verification exception during migration. Do not infer it indefinitely from an unverified email flag.
- Keep notification read state separate from the Viewing request decision. Reading a request does not approve or reject it.
- Make approval and rejection safe to retry. A stale notification cannot reverse a later decision or restore revoked access.
- Preserve existing channel enable controls and the suspension behavior that disables publishing and removes stream keys.
- Add SMTP configuration to deployment environment forwarding and setup documentation.
- Leave playback timing, buffering, and protocol selection unchanged.

## Verification plan

- Exercise password and provider registration, first sign-in, automatic channel creation, and verification restrictions.
- Verify migration for active, pending, and disabled accounts, including existing channels and missing-channel creation.
- Exercise an owner, an unapproved viewer, an approved viewer, an administrator-approved account, and a suspended account against the same channel.
- Check direct HLS, WebRTC, thumbnail, and chat requests before and after approval and revocation.
- Verify that an owner can watch and moderate their own channel without Administrator approval.
- Check concurrent Viewing requests, duplicate notification delivery, stale approval actions, and the 30-minute retry boundary.
- Verify persisted approvals across sign-out, stream restarts, and removal of Administrator approval.
- Exercise notification read state, sound settings, missed notifications, and multiple open tabs in a browser.
- Verify SMTP messages and links through a local mail receiver. Exercise expired and reused recovery links, provider-only accounts, and the legacy admin-reset fallback.
- During implementation, run the affected test groups, lint, type checks, and the build. Complete the repository's required verification before committing implementation changes.

## Accepted interface and request defaults

- Hide a new account's channel from other accounts until email verification completes. The owner can still open its management page.
- Administrator approval closes pending Viewing requests as no longer needed. Removing Administrator approval does not reopen them.
- The header notification center has an unread count, read controls, and approve or reject actions. The channel page lists pending requests and stored approvals, with revocation controls.
- The channel-page sound setting applies to all in-app notifications for that account and persists across devices.

The maintained [account access guide](../../docs/account-access.md) consolidates these rules and their reasons.

## Deployment prerequisite

SMTP service credentials and a sender address must be configured before deployment.

## Interview record

The requested behavior above comes from the initial request.
Recommendations in the interview are proposals until the user accepts them.
Implementation has not started.

### Round 1: account approval

The user accepted separate administrator approval and account suspension.
New accounts can sign in and stream. Administrator approval grants viewing access to all channels.

### Round 2: viewing requests

The user accepted an explicit **Request to watch** action and one pending request per account and channel.
Channel approval persists across visits and stream restarts.

### Round 3: owner control

The user accepted owner revocation of Channel approval.
Owners cannot exclude accounts with Administrator approval from viewing.

### Round 4: restricted channel visibility

The user accepted channel name, owner, live status, and a locked image for restricted channels.
Chat remains hidden until the account has Viewing access.

### Round 5: stored notifications and sound

The user accepted stored notifications for owners and viewers, including while signed out.
Sound starts enabled, muting affects only sound, and old notifications remain silent on return.

### Round 6: email verification and recovery

The user accepted email verification before publishing or requesting Viewing access.
Password recovery uses email links. Provider-only accounts use their provider's recovery process.
The transition was unresolved in this round and was settled in rounds 7 and 10.

### Round 7: existing password accounts

The user accepted preservation of existing accounts' current access.
Existing email addresses remain unverified until verified. New accounts must meet the new verification requirement.

### Round 8: repeat requests

The user selected a 30-minute delay after rejection or revocation before another request is allowed.

### Round 9: removal of administrator approval

The user accepted preservation of stored Channel approvals when Administrator approval is removed.
Channels without a stored approval require a new request.

### Round 10: recovery for existing accounts

The user accepted verification while signed in before an existing account can use email password recovery.
Administrator-generated reset links remain available as a fallback.

### Round 11: email delivery

The user selected configurable SMTP delivery. No mail service is selected yet.
The mail account and sender address must be configured before deployment.

### Round 12: notification delivery scope

The user selected in-app notifications only for this version.
Requests remain stored while the site is closed and appear on return.

### Round 13: channel creation and chat

The user selected automatic Channel creation at registration.
Owners can watch and moderate their own channel without Administrator approval.
Accounts with Channel approval can read and send chat, subject to existing restrictions.

### Round 14: existing accounts and channels

The user accepted mapping active accounts to Administrator approval, pending accounts to unapproved sign-in, and disabled accounts to Account suspension.
Existing channels remain. Each non-suspended account without a channel receives one.

### Round 15: final defaults

The user accepted all four proposed defaults: channel visibility before verification, closure of pending requests after Administrator approval, notification actions and channel-page management, and a sound setting that persists across devices.

### Final confirmation

The user confirmed the complete design and chose to finish the documentation session.
Implementation is a separate task. This planning session does not commit or push changes.

## Frontend prototype

The separate UI prototype is captured on `codex/prototype-open-registration`.
The user selected A, with the requirement to retain the existing application layout and controls.
See [the prototype review issue](issues/01-frontend-access-flow.md) for the source and walkthrough.
