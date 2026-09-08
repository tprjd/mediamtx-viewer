# 01: Home card grid

**What to build:** The home page becomes a uniform card grid of all channels, like Twitch's browse page. Live channels come first, then viewer count, then title. Each card has a 16:9 media area: the channel poster image when set, otherwise the channel initial on an accent-colored panel. Below the media area: live badge, viewer count, title, owner. Status updates in real time, and clicking a card opens that channel's watch page.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Home renders all channels as a uniform card grid; the featured hero and vertical list are removed
- [x] Grid sorts live channels first, then viewer count descending, then title
- [x] Card media area shows the poster image when the channel has one, otherwise the channel initial on an accent-colored panel
- [x] Card shows live badge, viewer count, title, and owner
- [x] Channel status in the grid updates in real time without a refresh, through the existing channel-events stream
- [x] Clicking a card opens that channel's watch page
- [x] A quiet "No channels yet" note renders when no channels exist
- [x] Sort logic is tested as a pure model function
- [x] Grid rendering is covered by component render tests, following the existing home dashboard test pattern
- [x] End-to-end flow: the home grid renders and clicking a card reaches the watch page

## Comments

Implemented in commit `4421042`. The feature flow was verified before this ticket was resolved.
