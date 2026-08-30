# Watch-First Landing Page Plan

> Status: implemented and deployed on 2026-08-30.
>
> Scope: redesign the authenticated `/` page as the friend group's channel
> dashboard. The login and registration pages remain separate.

## Release status

The watch-first dashboard is live at `https://frankerzspam.duckdns.org/`.
Implementation includes the featured-live layout, quiet/unavailable/empty
states, deterministic CSS channel artwork, live-first sorting, synchronized
polling, last-known-status preservation, conditional streamer/admin shortcuts,
responsive header navigation, and low-frequency stream thumbnails.

Verified before and after deployment:

- type checking, linting, and production builds pass;
- 45 unit, integration, component, route, and worker tests pass;
- 14 desktop/mobile Playwright tests pass, including a 320-pixel overflow check;
- desktop, mobile, offline, and simulated-live states were visually inspected;
- the Oracle viewer is healthy and the authenticated live page renders the new
  dashboard, account-specific shortcuts, and current channel state;
- the landing page creates no WebRTC or HLS connection.
- the Oracle thumbnail worker is deployed with a private HLS connection and a
  persistent image volume; local MediaMTX integration captures passed with both
  H.264 and AV1 sources. The first production JPEG will be created during the
  next broadcast because the channel was offline at deployment.

## Goal

Make the first screen answer three questions immediately:

1. Is anyone live?
2. What are they streaming?
3. Where do I click to watch?

The page should feel like a private shared place rather than a public streaming
platform. It should stay useful when nobody is live, work well with one channel
or a growing list, and remain inexpensive to serve from the Oracle free-tier VM.

## Current-page issues

The current page is clean, but the large `Pull up a chair` hero consumes most of
the first viewport without helping a viewer choose a stream. The actual channels
start below it, and every channel has the same visual priority whether live or
offline.

Other gaps:

- The live count is rendered outside the polling component, so it can become
  stale while channel cards update.
- There is no prominent one-click route into the currently live stream.
- The empty and all-offline states do not provide a tailored message.
- The generic gamepad placeholder does not give channels much identity.
- Streamers have no quick path from home to their own channel controls.
- The layout is designed as a fixed hero plus grid rather than a dashboard that
  adapts to zero, one, or several live channels.

## Recommended direction

Use a compact welcome band followed immediately by live content. Keep the
existing dark, restrained visual language, but give the page more hierarchy,
channel identity, and useful state changes.

The main rules are:

- Live channels always come first.
- With at least one live channel, the first live channel becomes the featured
  card and gets the primary `Watch live` action.
- Other live channels remain clearly visible beside or below the featured card.
- Offline channels stay in an `All channels` section and remain clickable.
- With no live channels, show a deliberate quiet-state panel rather than an
  empty featured area.
- Do not embed or autoplay video on the landing page. A preview would create an
  additional MediaMTX reader, use bandwidth before the viewer chooses a stream,
  and behave poorly on mobile connections.
- When available, show a server-generated still image captured five seconds
  after publishing starts and refreshed every three minutes. This is derived
  artwork, not embedded playback.
- Do not add search or category filters yet. They add noise for a small friend
  group and can be introduced when the directory grows beyond roughly eight
  channels.

## Desktop structure

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Home Stream                         My channel   Account   power          │
├──────────────────────────────────────────────────────────────────────────┤
│ PRIVATE STREAMS                                      ● 2 LIVE NOW        │
│ What are we watching?                                                   │
│ A small place for broadcasts from the group.                            │
├──────────────────────────────────────────────────────────────────────────┤
│ LIVE NOW                                                                 │
│ ┌────────────────────────────────────┐ ┌───────────────────────────────┐ │
│ │ abstract channel artwork       LIVE│ │ David                         │ │
│ │                                    │ │ Late-night games               │ │
│ │                                    │ │ Playing from home.             │ │
│ └────────────────────────────────────┘ │ [ Watch live → ]              │ │
│                                        └───────────────────────────────┘ │
│                                                                          │
│ More live                                                               │
│ ┌──────────────────────┐ ┌──────────────────────┐                       │
│ │ channel card         │ │ channel card         │                       │
│ └──────────────────────┘ └──────────────────────┘                       │
├──────────────────────────────────────────────────────────────────────────┤
│ ALL CHANNELS                                      Status updates live    │
│ ┌──────────────────────┐ ┌──────────────────────┐ ┌───────────────────┐ │
│ │ compact channel card │ │ compact channel card │ │ compact card      │ │
│ └──────────────────────┘ └──────────────────────┘ └───────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

The featured layout should use approximately a two-thirds visual panel and a
one-third information panel on wide screens. It collapses into one card before
space becomes cramped.

## Mobile structure

```text
┌──────────────────────────────┐
│ Home Stream      Account  ☰  │
├──────────────────────────────┤
│ ● 1 LIVE NOW                 │
│ What are we watching?        │
│ Private streams from friends │
├──────────────────────────────┤
│ LIVE NOW                     │
│ ┌──────────────────────────┐ │
│ │ 16:9 channel artwork     │ │
│ ├──────────────────────────┤ │
│ │ David                    │ │
│ │ Late-night games         │ │
│ │ [ Watch live → ]         │ │
│ └──────────────────────────┘ │
│                              │
│ ALL CHANNELS                 │
│ ┌──────────────────────────┐ │
│ │ channel card             │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

The primary action must be visible without horizontal scrolling, tap targets
must be at least 44 pixels high, and the header should not squeeze every account
link into one row. If the current menu becomes crowded, collapse its secondary
links into a small menu while preserving direct access to the account.

## Page states

### One or more channels live

- Show the accurate live count in the welcome band.
- Feature the first live channel using a deterministic order.
- Label the featured card with both `Live` and its owner display name.
- Use the channel title as the main heading and description as secondary copy.
- Make the whole artwork/card clickable, while retaining a clearly labelled
  `Watch live` button for an obvious action.
- Put remaining live channels in `More live`; omit this subsection when there is
  only one.
- Include every channel in `All channels`, sorted live first and then by stable
  creation order. Duplication is intentional: the feature is a shortcut, while
  the directory remains complete.

### All channels offline

- Replace the live feature with a compact `Quiet right now` panel.
- Use friendly copy such as `No broadcasts are live. You can still open a
  channel and wait there.`
- Keep `All channels` immediately below the quiet state.
- Do not invent schedules, last-streamed times, games, or notification controls
  until the data model supports them.

### No enabled channels

- Show `No channels yet` with an explanation appropriate to a private group.
- Administrators get a link to `/admin/users` to grant streaming access.
- Other users see a neutral message without an unusable action.

### Status service unavailable

- Keep channel navigation available.
- Display `Status unavailable` rather than treating every channel as offline.
- Preserve the last successfully received state during client polling, and add a
  subtle stale indicator only after repeated failures.
- Never turn a brief MediaMTX API failure into a full-page error.

## Components and data flow

Replace the current split between a server-rendered live count and a separately
polling directory with one client-owned dashboard state.

```text
HomePage server component
  ├─ load enabled channels from SQLite
  ├─ fetch MediaMTX statuses once
  ├─ load the active user's channel/admin capabilities
  └─ pass serializable initial model to HomeDashboard
       ├─ WelcomeBand
       ├─ FeaturedChannel or QuietState
       ├─ LiveChannelRow
       └─ ChannelGrid
            └─ ChannelCard
```

`HomeDashboard` should own the existing five-second polling loop so the live
count, featured channel, and cards change together. It should:

- pause polling while the tab is hidden;
- cancel in-flight requests on unmount;
- keep the previous successful state when a request fails;
- avoid overlapping polls;
- select the feature deterministically so cards do not jump between polls;
- announce a channel becoming live through a polite ARIA live region without
  repeatedly announcing unchanged status;
- respect reduced-motion preferences.

The `/api/channels` response already provides the needed channel and status
data. Add capability flags to the server-rendered page model rather than to the
public channel API: `hasOwnedChannel` and `isAdmin` are user-specific and should
not be cached or exposed as directory data.

## Visual system

Retain the black/neutral base and violet accent, with each channel's existing
`accentColor` supplying its identity. Live cards may use the latest derived
stream thumbnail, but the design must not depend on uploaded posters because
poster storage and moderation are outside the current product.

Recommended channel artwork fallback:

- deterministic gradient generated from the configured accent color;
- a large initial or short display-name mark rather than the generic gamepad;
- a subtle texture made in CSS, not a large downloaded asset;
- live cards receive a restrained red/pink status treatment, while the channel
  accent remains the identity color;
- offline cards use lower contrast without appearing disabled.

Typography should reduce the current oversized headline to a compact responsive
range around 2.5–5rem. The page should prioritize channel titles over decorative
copy. Motion should be limited to short hover/focus transitions and a gentle
live-dot pulse that is disabled under `prefers-reduced-motion`.

## Header improvements

- Keep the brand linked to `/`.
- Show `My channel` only to users who own a channel.
- Keep `Admin` visible only to administrators.
- Keep account/sign-out controls discoverable.
- On mobile, use an accessible popover/menu if the actions no longer fit.
- Do not place a stream key, email address, or account role in the header.

## Accessibility

- Use one page-level `h1`, followed by properly nested section headings.
- Ensure card links have descriptive accessible names such as
  `Watch David — Late-night games, live`.
- Do not communicate live/offline state through color alone.
- Maintain visible keyboard focus on cards and actions.
- Check contrast for arbitrary channel accent colors; use them decoratively and
  keep critical text on known neutral colors.
- Avoid nested interactive elements. If a whole card is a link, style a span as
  the visual action instead of placing a button inside it.
- Preserve layout and meaning at 200% zoom and down to a 320-pixel viewport.
- Use skeletons only during actual navigation loading, not during every status
  poll.

## Performance and free-tier constraints

- No video, WebRTC, HLS, or animated canvas is opened by a landing-page browser.
- A private FFmpeg worker may decode one 640×360 frame per live channel at start
  and every three minutes; the final JPEG is retained after the stream ends but
  is not displayed while the channel is offline.
- Keep the existing single batched MediaMTX status request.
- Use CSS artwork until user-uploaded channel images have a storage design.
- Avoid a new UI framework or animation dependency.
- Keep client JavaScript limited to polling, status transitions, and an optional
  mobile menu.
- The page must remain fully navigable from the server-rendered initial state if
  client JavaScript is delayed.

## Implementation sequence

### Phase 1: dashboard model

1. Add a small home-page view-model function that sorts live and offline
   channels deterministically and selects the featured channel.
2. Load session-derived header/home capabilities server-side.
3. Replace `ChannelDirectory` with `HomeDashboard`, moving the polling loop into
   the new component.
4. Represent status-fetch failure explicitly instead of forcing `offline`.

### Phase 2: layout and components

1. Build the compact welcome band and live-count treatment.
2. Build the featured-live and quiet-state variants.
3. Redesign `ChannelCard` with deterministic CSS artwork and clearer hierarchy.
4. Add conditional `More live` and complete `All channels` sections.
5. Add streamer/admin quick links without exposing them to unauthorized users.

### Phase 3: responsive and interaction polish

1. Collapse the feature and channel grid cleanly across desktop, tablet, and
   mobile breakpoints.
2. Make the header resilient to extra authenticated actions.
3. Add focus, reduced-motion, polling-failure, and live-transition behavior.
4. Verify long display names, titles, descriptions, and three or more live
   channels do not break the layout.

### Phase 4: validation and rollout

1. Add unit tests for sorting, feature selection, zero-channel, all-offline, and
   failed-status models.
2. Add component tests for accessible names and state announcements.
3. Expand Playwright coverage for desktop and mobile live/offline states.
4. Run type checking, linting, unit tests, production build, and browser tests.
5. Deploy to Oracle and verify the page using authenticated viewer, streamer,
   and administrator accounts.

## Acceptance criteria

- A live stream and its watch action are visible in the first desktop and mobile
  viewport.
- The displayed live count, feature, and directory remain synchronized after
  polling updates.
- Zero-live, multiple-live, zero-channel, and MediaMTX-unavailable states each
  have intentional UI.
- Every enabled channel remains reachable whether live or offline.
- The landing page creates no media sessions before the viewer chooses a
  channel.
- Streamer/admin shortcuts appear only for authorized accounts.
- Keyboard, screen-reader, reduced-motion, 200% zoom, and 320-pixel-width checks
  pass.
- No new runtime dependency is required.
- Desktop and mobile Playwright tests, production build, and live Oracle smoke
  tests pass.

## Explicitly deferred

- Public marketing page outside authentication.
- Video preview/autoplay on channel cards.
- Chat, reactions, viewer counts, schedules, notifications, and activity feeds.
- Search, categories, and recommendations.
- Poster uploads or third-party image hosting.
- Watch history and `Continue watching` until there is a clear privacy and data
  retention decision.

## Recommended product decisions

These defaults are sufficient to implement the plan:

1. Treat `/` as the authenticated watch dashboard, not a public marketing page.
2. Feature the first live channel deterministically; do not rotate it
   automatically.
3. Duplicate the featured stream in `All channels` so the directory stays
   complete and predictable.
4. Use the latest derived stream thumbnail when available, with generated CSS
   artwork as the reliable fallback; do not add uploads or stock images.
5. Keep the landing page playback-free until the viewer explicitly selects a
   channel.
