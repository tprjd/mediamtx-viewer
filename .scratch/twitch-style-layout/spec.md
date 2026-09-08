# Spec: Twitch-style layout

Status: implemented

## Problem Statement

The viewer-facing pages do not read like Twitch. The home page is a featured hero plus a vertical list, and the watch page is a bare player with details underneath. A viewer on the watch page has no way to see which other channels are live without leaving the page. The layout, not the visual style, is what keeps the site feeling unlike Twitch.

## Solution

Restructure the information architecture of the two viewer-facing pages, keeping the existing visual identity untouched:

- **Home** becomes a pure card grid of all channels (live first), like Twitch's browse page.
- **Watch** becomes a three-column layout: a **Live rail** on the left listing every live channel, the player in the middle with a compact two-row info bar underneath, and an honest chat placeholder on the right that previews the future chat layout.
- The Live rail is collapsible (icon rail / expanded list), prefers persist, and can be hidden completely from a header toggle. It updates in real time, so a viewer on one live channel can move to any other without going home.

## User Stories

1. As a viewer, I want the home page to be a card grid of all channels, so that I can scan every channel at a glance like Twitch browse.
2. As a viewer, I want live channels sorted to the top of the grid, so that live content stands out immediately.
3. As a viewer, I want channels sorted by viewer count within each group, so that the most-watched channels come first.
4. As a viewer, I want a stable title tie-break in the sort, so that the grid order does not jump around between refreshes.
5. As a viewer, I want channel cards to show a poster image when one is set, so that channels carry a visual identity.
6. As a viewer, I want a channel-initial fallback on the card when no poster is set, so that every card stays consistent.
7. As a viewer, I want each card to show a live badge, viewer count, title, and owner, so that I can judge a channel without opening it.
8. As a viewer, I want channel status in the grid to update in real time, so that I do not need to refresh to see a channel go live.
9. As a viewer, I want clicking a card to open that channel's watch page, so that I can start watching.
10. As a viewer, I want a quiet "no channels yet" note when no channels exist, so that the page does not look broken.
11. As a viewer watching a live channel, I want the player centered with channel information beneath it, so that the layout reads like Twitch.
12. As a viewer, I want a first info row with the status badge, viewer count, title, and owner beneath the player, so that the channel's identity is clear at a glance.
13. As a viewer, I want a second info row with the playback mode controls, share action, and playback stats, so that the controls live in one predictable place.
14. As a viewer, I want a chat placeholder column on the right of the watch page, so that the final chat layout is visible before chat exists.
15. As a viewer, I want the placeholder to show a "chat is coming soon" note and a disabled input, so that it is clear chat is not implemented yet.
16. As a viewer on a narrow screen, I want the chat placeholder hidden and the player full width, so that the player gets all the space.
17. As a viewer watching an offline channel, I want the chat placeholder hidden, so that there is no dead column.
18. As a viewer watching an offline channel, I want the existing offline state to remain unchanged, so that nothing is lost.
19. As a viewer on the watch page, I want a Live rail listing every live channel, so that I can discover other live channels without going home.
20. As a viewer, I want the currently watched channel highlighted in the Live rail, so that I know where I am in the list.
21. As a viewer, I want clicking a Live rail item to switch to that channel, so that I can move between live channels in one click.
22. As a viewer, I want the Live rail to collapse to a thin icon rail, so that I can give the player more width.
23. As a viewer, I want the Live rail expanded by default on first visit, so that discovery is visible first.
24. As a viewer, I want my Live rail state (expanded, collapsed, or hidden) to persist across visits, so that I do not reconfigure it every time.
25. As a viewer on a narrower desktop, I want the Live rail to auto-collapse below 1280px, so that the player is not squeezed.
26. As a viewer, I want a header toggle to hide the Live rail completely, so that I can remove it when I do not want it.
27. As a viewer, I want the Live rail to update in real time as channels go live or offline, so that the list is always current.
28. As a viewer, I want a "no live channels" note when nothing is live, so that the rail does not look broken.
29. As a viewer on a narrow screen, I want the Live rail hidden, so that the player gets all the space.
30. As a channel owner, I want my channel to appear in the home grid with its poster, status, and viewer count, so that viewers can find it.
31. As a channel owner, I want this layout change to leave publishing, playback, and recovery behavior untouched, so that my stream keeps working exactly as before.
32. As an administrator, I want admin, account, statistics, and auth pages unchanged, so that tooling is not disturbed by a viewer-facing redesign.

## Implementation Decisions

- **Scope is layout and information architecture only.** No visual identity change: the pink accent, theme tokens, typography, and header structure stay as they are.
- **Viewer-facing pages only**: home and watch. All other pages are untouched.
- **Home grid**: the featured hero and vertical list are replaced by a uniform card grid of all channels. Each card has a 16:9 media area: the channel poster image when set, otherwise the channel initial on an accent-colored panel (the existing fallback pattern). Below the media area: live badge, viewer count, title, owner.
- **Home sort**: live channels first, then viewer count descending, then title. The sort lives in the home dashboard model as a pure function; the featured-channel split in that model is dropped.
- **Real-time updates**: both pages keep using the existing channel-events stream (SSE with polling fallback). No new events machinery.
- **Watch page data**: the watch page seeds the channel-events hook with **all** channels instead of only the watched one, so the watched channel and the Live rail share a single events stream. This is a server-side data change on the watch page only; the channel API contracts are unchanged.
- **Watch layout (live channel)**: three columns. Left: Live rail (64px collapsed / 240px expanded). Middle: player, flexible width. Right: chat placeholder, fixed ~340px. Side columns are fixed; the player absorbs width changes.
- **Info bar under the player**: row 1 = status badge, viewer count, title, owner. Row 2 = playback mode controls, share action, playback stats. The playback mode switch and playback stats move out of the player tree into this row; the channel viewer composes the row. Cross-protocol selection stays in the existing playback mode hook, and transport actions stay in the HLS and WebRTC adapters, per the streaming contract.
- **Chat placeholder**: an honest stub. A "Chat is coming soon" note and a disabled input box. No fake messages. It previews the final layout and nothing more.
- **Watch layout (offline channel)**: the Live rail stays; the chat placeholder is hidden; the existing offline state is unchanged; the player area takes the placeholder's width.
- **Narrow screens (watch)**: below desktop width, both the Live rail and the chat placeholder are hidden and the player is full width.
- **Live rail**: watch page only. Collapsed form is a thin icon rail of channel initials; expanded form lists title, owner, and viewer count per live channel. The watched channel gets an active highlight. Empty state is a short "No live channels" note. It updates in real time through the shared events stream.
- **Live rail preferences**: expanded by default; the choice (expanded / collapsed / hidden) persists in localStorage. The rail auto-collapses to the icon rail below 1280px without overriding the persisted choice at full width. A header toggle button hides the rail completely; the choice persists.
- **Header**: structure unchanged. The rail toggle is a small client-side control shown only on the watch page, since the rail exists only there. The header itself remains a server component.
- **Domain language**: "Live rail" is the canonical term for this feature and is recorded in the context glossary (done during the design interview).
- **No schema changes, no API contract changes, no ADRs.** Every decision is cheap to reverse.

## Testing Decisions

- **Good tests assert external behavior only**: what renders, what changes on interaction, what the model functions return. No implementation details, no internal state.
- **Pure model functions** are the highest seam for sort and derive logic:
  - Home dashboard model: new sort order (live first, viewer count desc, title), featured split removed.
  - New Live rail model: derives the live channels, sorts them, and marks the watched slug.
- **Component render tests** cover the layouts, following the existing pattern of mocking the channel-events hook and the player:
  - Channel viewer: three-column live layout, two-row info bar, offline layout (rail stays, placeholder hidden), narrow behavior.
  - Home dashboard: card grid rendering, poster-with-fallback media area, badges, empty state.
  - Live rail: collapsed icon rail, expanded list, active highlight, empty note.
  - Header rail toggle: visible on the watch page only, persists the choice.
- **E2E** extends the existing viewer flow: home grid, click a card, watch page with Live rail, switch to another live channel via the rail.
- **Prior art**: the existing channel viewer render test (mocked events hook and player), the home dashboard render test (pure channel data), the home dashboard model tests, and the existing Playwright viewer spec.
- **No new test infrastructure**: no new runners, no new mock boundaries. Real-time behavior keeps flowing through the existing events hook.

## Out of Scope

- **Real chat**: transport, persistence, moderation, and the live chat panel are a separate idea. Only the placeholder is built here.
- **Visual identity**: colors, accent, typography, theme tokens, and component styling do not change.
- **Non-viewer-facing pages**: account, admin, statistics, and auth pages are untouched.
- **Follows and search**: no follow feature, no search field, no home-page sidebar.
- **Header restructuring**: no nav tabs, no search; only the rail toggle is added.
- **Mobile chat overlay**: how real chat behaves on narrow screens is decided when chat is built.
- **Player behavior**: playback modes, playback runs, recovery, and the streaming contract are unchanged.

## Further Notes

- This is a multi-session build. Suggested ticket split: (1) home card grid, (2) watch page layout with chat placeholder and info bar, (3) Live rail with preferences and header toggle. Tickets 2 and 3 both touch the watch page; the rail builds on the three-column layout from ticket 2.
- The channel poster and accent color already exist in the channel data model; no new data is required.
- The watch page currently tracks only the watched channel through the events hook; seeding it with all channels is the one behavioral change to that page's data flow.

Implementation completed in commits `4421042`, `979ce67`, `aae828b`, and `e372f59`.
