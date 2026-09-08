# 02: Watch page layout with chat placeholder

**What to build:** The watch page becomes a Twitch-style layout: the player in the middle, a compact two-row info bar beneath it, and an honest chat placeholder column on the right that previews the future chat layout without pretending chat exists.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] For a live channel: the player takes the flexible middle and the chat placeholder is a fixed ~340px column on the right
- [x] Info bar row 1 beneath the player: status badge, viewer count, title, owner
- [x] Info bar row 2: playback mode controls, share action, and playback stats, moved out of the player tree; cross-protocol selection stays in the existing playback mode hook and transport actions stay in the adapters
- [x] The chat placeholder shows a "Chat is coming soon" note and a disabled input box; no fake messages
- [x] For an offline channel: the chat placeholder is hidden, the existing offline state is unchanged, and the player area takes the placeholder's width
- [x] On narrow screens: the chat placeholder is hidden and the player is full width
- [x] Layouts are covered by channel viewer render tests (live, offline, narrow), following the existing mocked events-hook and player pattern
- [x] Playback modes, playback runs, recovery, and the streaming contract are unchanged

## Comments

Implemented in commit `979ce67`. The feature flow was verified before this ticket was resolved.
