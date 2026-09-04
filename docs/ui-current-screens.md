# Current UI — Screen Inventory

Reference document for design work. It lists every screen that currently exists,
what it shows, and the rough structure of each, so a design agent can compare the
current app against a target design without reading the source.

App product name shown in the header: **Home Stream**. Product/domain language
uses "channel" (not stream), "stream key", "playback mode", "OBS setup session",
and similar terms; a design should keep those names.

## Global shell (all screens)

Visual language: dark theme (`#09090b` background), two fixed blurred violet/indigo
"ambient" glow blobs in the backdrop, near-white text, muted gray secondary text,
thin white-on-dark borders, translucent panels with rounded corners, uppercase
violet "eyebrow" labels, and Lucide line icons. Fully responsive; the app is
tested down to a 320px viewport.

Every page is wrapped in a shared shell:

- Header bar: brand at left (radio-tower icon + "Home Stream", links to home).
- Right side of header: contextual account navigation — always shows
  "Statistics" and the signed-in user's name ("Account") for members; admins also
  get "Admin"; channel owners also get "My channel". There is a Sign out button.
  Signed-out visitors see no menu.
- No footer. Pages are top-level `<main>` content below the header.
- Shared system states: a full-page loading state ("Checking the signal…" with a
  pulsing dot), a branded 404 page ("That channel does not exist." / "No signal"),
  and a generic error page ("The viewer hit a problem." with Try again).

Common building blocks used across screens:

- **Status pill / badge**: round pill showing Live (pulsing red dot), Offline, or
  Unknown/status unavailable (amber).
- **Viewer count**: small person-count chip, only visible while a channel is live.
- **Channel accent color**: each channel carries an accent color used on hover,
  artwork, and playback frames.
- **Panels**: bordered translucent cards used for account settings, admin cards,
  and statistic cards.
- **Banners**: inline green notice, red error, or amber reset-key banners after
  server actions.

---

## 1. Home / channel directory — `/`

Purpose: private group landing page showing every channel and what is live now.

Content, top to bottom:

- Intro block: eyebrow "Private streams", large display heading "What are we
  watching?", short subtitle, and a live-summary pill ("N live now", amber
  "Status delayed", or gray "0 live now").
- Right of the intro, contextual shortcuts: "My channel" for channel owners,
  "Manage users" for admins.
- "Live now" section when any channel is live: a large **featured channel** card
  (artwork/poster or big initial, live badge + viewer count overlaid, title,
  description, owner name, "Watch live" affordance). When nothing is live a
  **quiet state** replaces it ("Quiet right now." with radio icon, or a warning
  variant when status checks are unavailable).
- "More live" grid when more than one channel is live (compact channel cards).
- "All channels" grid of compact cards: poster or initial-letter placeholder,
  live/offline badge and viewer count overlaid, title, description, owner name,
  corner arrow. If no channels exist, an empty state invites the admin to grant
  streaming access.

Live status, counts, and posters update in place over an authenticated
server-sent event feed; announcements like "X is live now" are read aloud to
screen readers rather than shown visibly.

## 2. Watch page — `/watch/[slug]`

Purpose: single-channel live viewer.

Structure, top to bottom:

- **Playback mode bar** (top of the player container): label "Playback mode"
  with one-line description of the current mode, and four mode buttons:
  "HLS ≤3s" (experimental ultra-low), "Balanced", "Smooth", and "Low latency"
  (WebRTC). Buttons show when a mode is unavailable or is cooling down ("Try low
  latency in Ns"). The chosen mode persists per browser tab.
- **Video player**: dark rounded video frame with the channel's accent glow,
  Vidstack controls overlaid on hover (play/pause, mute + volume slider, live
  badge/button, picture-in-picture, fullscreen; keyboard shortcuts enabled),
  auto-start muted, poster image while waiting, and a small protocol badge
  ("HLS · Balanced", "WebRTC · Low latency") while playing.
  - Player overlays cover the video depending on state: "Joining stream",
    "Reconnecting", "Stream offline" (auto-retries), "Session expired" (sign-in
    button returning to this channel), "Video format not supported" (offers a
    compatibility stream when one exists), or "Playback interrupted" / WebRTC
    fallback messages with Try again / Use HLS now actions.
- **Playback diagnostics strip** directly under the video: collapsible
  "More"-style row showing Status (Playing/Waiting), Mode, Quality
  (resolution · fps), Live latency or Network RTT, Forward buffer or Loss rate.
  Expanding it shows a technical grid: codecs, resolution, frame rate, frame
  pacing chart, latency/buffer targets, SLO breach counters, transport, and a
  "Copy snapshot" button for bug reports.
- **Channel details** below the player: live/offline badge and viewer count,
  channel title, description, owner name, "Live playback" tag, codec/track
  summary, and a share button (native share or copy-link).

## 3. Sign in — `/login`

Purpose: authenticate members.

Centered card on the ambient background: eyebrow "Private stream", heading
"Welcome back.", short explanation of single sign-on covering pages, HLS, and
WebRTC, a username/password form with inline error text, and a footnote link to
request an account. Supports a `returnTo` query parameter that redirects back to
the original destination (e.g. a watch page) after sign-in.

## 4. Request access — `/register`

Purpose: request a new member account (admin must activate it).

Same centered-card layout. Heading changes with state:

- Registration open: "Request an account." with form: display name, username
  (pattern hint), email, password (15+ chars hint).
- Registration closed: "Registration is closed." with a plain message and no
  form.

Footnote links back to Sign in.

## 5. Registration pending — `/registration-pending`

Purpose: confirmation shown after submitting an access request.

Centered card, clock icon, "Request received" eyebrow, "Waiting for approval.",
message that an administrator will activate the account, and a link back to
Sign in.

## 6. Reset password — `/reset-password`

Purpose: choose a new password from a one-time emailed/linked token (15-minute
expiry).

Centered card, eyebrow "Account recovery", "Choose a new password.", expiry note,
and a two-field form (new password + confirmation). If the token is missing, an
error note is shown. On success the card swaps to a success message with a link
to Sign in.

## 7. Account — `/account`

Purpose: self-service profile and security settings for a signed-in member.

Vertical stack of panels below a heading showing the user's display name and
email:

- **Profile name**: single-field form to change the display name shown under the
  user's channel; Save button.
- **My channel**: status line — either "Manage OBS publishing for
  /watch/<slug>." with a Manage channel button, or "Streaming access has not
  been granted" with a Channel status button that still opens the channel page.
- **Change password**: current/new/confirm password form; changing it signs out
  every other session (explained in the copy).
- **Sessions**: count of active sessions plus a list of devices/user agents with
  expiration dates.

## 8. My channel (channel owner) — `/account/channel`

Purpose: manage the one channel the account owns: OBS setup download, publishing
credentials, metadata, and broadcast control.

Requires an owned channel; without one the page shows a "Viewer account"
message with a back link. With a channel, panels under a header card containing
the channel title, its public `/watch/<slug>` link, and an enabled/disabled
indicator:

- **Windows OBS setup**: download button for a Windows setup launcher
  (version + SHA-256 shown), notes about signing and what the script does.
  Only available while the channel is enabled.
- **OBS publishing**: three read-only values with copy buttons — Service
  (WHIP), Server URL, and current stream-key hint ("Current key ends in …"). A
  Generate/Rotate stream key button reveals the full key exactly once inside a
  highlighted box ("Copy this key now. It will not be shown again."). Rotation
  requires confirmation because it kills the current key immediately.
- **Channel details**: title and description text inputs with Save.
- **End broadcast**: destructive-style button that disconnects the publisher
  and every current viewer of this channel.

## 9. Authorize OBS setup — `/account/channel/obs-setup/[code]`

Purpose: short-lived, single-use authorization page opened by the Windows setup
script; binds that computer to the channel and delivers fresh credentials.

Header card with shield icon, "Authorize this computer", and the displayed code.
If valid and the channel is enabled: explanation of what approval does, plus
Authorize and Deny buttons. If the code is invalid/expired/used or streaming is
disabled: "Setup request unavailable" message and a link back to My channel.

## 10. Administration — `/admin/users`

Purpose: admin-only user and access management.

Header row: "Viewer access" title with description plus a registration
toggle ("Registration is open/closed" + Open/Close button). Below:

- Optional banners: action results, and a one-time **password reset link**
  banner shown right after generating one (copy before reloading).
- Three grouped sections, each with an icon, heading, and count:
  **Pending / Active / Disabled**. Each user is a card showing name (with Admin
  badge), @username + email, activation badge, registration/activation dates,
  and contextual action buttons (Activate, Disable, Reject, Reset link, Revoke
  all sessions; expandable list of individual sessions with per-session Revoke).
- Active users without a channel get an inline **"Grant streaming"** form: a
  channel-slug input plus grant button. Active users with a channel instead get
  a channel summary (public path, enabled state, key hint) with View,
  Enable/Disable actions.
- **Recent activity** section: chronological audit lines ("Actor action ·
  target · time") and a Clear activity button (confirm dialog).

## 11. Statistics / infrastructure — `/statistics`

Purpose: signed-in members' view of Oracle Cloud free-tier usage and streaming
VM health (production-only data; locally it shows a "statistics disabled"
notice).

Layout is a long dashboard of panels:

- Header row: "Oracle usage" + description + Refresh OCI button.
- **Overall status hero**: icon + colored banner (Safe / Watch / Near limit /
  Charge detected / Unknown) with explanatory message and last-checked time.
- **Summary cards**: current-month cost (actual + forecast) and one quota card
  per limit (used / limit, projected value, horizontal progress bar, scope
  note).
- Two side-by-side panels: **Viewer instance** details grid (name, state, shape,
  OCPUs, memory, boot volume, region, created) and **Data sources** diagnostics
  (each source with ok/error/unknown icon, label, message, checked time).
- **VM health**: range switcher (1h / 24h / 7d) and a grid of small metric cards;
  each shows label, current value, average/max, and a compact sparkline SVG
  (or "No samples in this range").
- **Cost and usage lines**: full-width table (service, SKU, usage, actual,
  forecast), horizontally scrollable, with an empty state.
- Footer-style reference note distinguishing reference Free Tier limits from
  Oracle's authoritative billing, with external Oracle links.

---

## Screen access summary

| Area | Route | Signed-in | Channel owner | Admin |
| --- | --- | --- | --- | --- |
| Home directory | `/` | yes | yes | yes |
| Watch page | `/watch/[slug]` | yes | yes | yes |
| Sign in / register / pending / reset | `/login`, `/register`, `/registration-pending`, `/reset-password` | no | – | – |
| Account | `/account` | yes | yes | yes |
| My channel | `/account/channel` | yes (own channel) | yes | also if owning |
| OBS authorization | `/account/channel/obs-setup/[code]` | yes (own channel) | yes | – |
| Admin users | `/admin/users` | – | – | yes |
| Statistics | `/statistics` | yes | yes | yes |

Notes for the design work:

- The channel owner and admin roles appear as extra header/home links rather
  than separate navigation systems.
- The watch page is intentionally tool-heavy (mode switcher + visible playback
  diagnostics) because latency modes and diagnostics are first-class features.
- Account/admin/statistics screens are functional, panel-stacked pages with few
  visual flourishes; the landing page and watch page carry most of the visual
  identity.
