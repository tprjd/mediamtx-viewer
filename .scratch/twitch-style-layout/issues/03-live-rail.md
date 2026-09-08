# 03: Live rail

**What to build:** A Live rail on the watch page's left listing every live channel, so a viewer on one live channel can move to any other without going home. The watched channel is highlighted, the rail updates in real time, and the watch page is seeded with all channels so the rail and the watched channel share one events stream.

**Blocked by:** 02: Watch page layout with chat placeholder

**Status:** resolved

- [x] The Live rail renders on the watch page's left and lists every live channel with title, owner, and viewer count
- [x] The currently watched channel is highlighted with an active state
- [x] Clicking a rail item switches to that channel's watch page
- [x] The rail updates in real time as channels go live or offline
- [x] A "No live channels" note renders when nothing is live
- [x] On narrow screens the rail is hidden and the player is full width
- [x] The watch page seeds the channel-events stream with all channels, so the rail and the watched channel share a single stream
- [x] Rail derivation (live channels, watched slug) is tested as a pure model function
- [x] Rail rendering is covered by component render tests (list, active highlight, empty note)
- [x] End-to-end: from the watch page, the viewer switches to another live channel via the rail

## Comments

Implemented in commit `aae828b`. The feature flow was verified before this ticket was resolved.
