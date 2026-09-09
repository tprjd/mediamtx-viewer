# Spec: Twitch-style interface refinement

Status: ready-for-agent

## Problem Statement

The viewer interface has a Twitch-like three-column watch layout, but the page still reads as a centered dashboard. The header content stops at a fixed maximum width. The channel rail sits inside the centered page instead of touching the left side of the window. The chat panel has the same problem on the right. Both panels scroll away with the document.

The tall header, rounded panels, background glows, large home introduction, and exposed technical controls also reduce the visual match. These choices leave less room for the video and weaken the clear viewing hierarchy that the user expects from Twitch.

## Solution

Refine the full signed-in viewer experience with a close Twitch-style layout while keeping the FrankerzSpam name, identity, and pink accent.

Use a compact sticky header across the full window. On home and watch pages, attach the channel rail to the left side below the header. On live watch pages, attach chat to the right side. Let each side panel fill the remaining window height and scroll its own content. The video takes all space released when a viewer collapses the channel rail or closes chat.

Keep the interface dark, compact, and flat. Remove the ambient glows and card-like player frame. Add theater mode, responsive channel navigation, a responsive chat placeholder, saved panel choices, clearer home sections, and a smaller settings area below the player. Do not add working chat, search, recommendations, or other Twitch product features.

## User Stories

1. As a viewer, I want the header to span the full window, so that the application frame resembles Twitch.
2. As a viewer, I want the header to remain visible while I scroll, so that navigation and account controls remain available.
3. As a viewer, I want a compact header, so that the video gets more vertical space.
4. As a viewer, I want the same full-window header on every page, so that the application frame stays consistent.
5. As a viewer, I want the FrankerzSpam name and pink accent to remain, so that the application keeps its identity.
6. As a viewer, I want the interface to use flat dark surfaces, so that content has a clear visual hierarchy.
7. As a viewer, I want the application to remove ambient background glows, so that the interface looks less like a centered dashboard.
8. As a viewer, I want compact navigation controls, so that the header does not crowd the video.
9. As a Channel owner, I want a visible My channel action, so that I can open my Channel without searching through a menu.
10. As a signed-in account holder, I want account initials in the header, so that I can open account actions from a compact control.
11. As an administrator, I want Admin in the account menu, so that I retain access without adding header clutter.
12. As a viewer, I want Statistics in the account menu, so that it remains available without taking permanent space.
13. As a signed-in account holder, I want Sign out in the account menu, so that account actions stay together.
14. As a viewer, I do not want an empty or fake search field, so that every visible control has a purpose.
15. As a viewer, I want non-viewer task pages to keep a centered content column, so that forms and administration pages remain readable.
16. As a viewer, I want the channel rail on both home and watch pages, so that I can change Channels without returning to a separate directory.
17. As a viewer, I want the expanded channel rail to touch the left side of the window, so that it feels attached to the application frame.
18. As a viewer, I want the channel rail to remain visible while the center content scrolls, so that Channel navigation stays available.
19. As a viewer, I want the channel rail to fill the window below the header, so that it uses the available vertical space.
20. As a viewer, I want a long channel rail to scroll independently, so that it does not increase the document height.
21. As a viewer, I want live Channels above offline Channels in the rail, so that active content is easier to find.
22. As a viewer, I want live Channels sorted by viewer count and then title, so that the order is useful and stable.
23. As a viewer, I want offline Channels sorted by title, so that I can find them predictably.
24. As a viewer, I want unavailable Channels to remain reachable with an accurate state label, so that a status failure does not remove a Channel.
25. As a viewer, I want the watched Channel highlighted in the rail, so that I know which Channel is open.
26. As a viewer, I want a collapsed icon rail when space is limited, so that Channel navigation uses less video width.
27. As a viewer, I want each collapsed rail item to show owner initials and live state, so that the icons remain useful.
28. As a viewer, I want a tooltip on each collapsed rail item, so that I can read the Channel title, Channel owner, and viewer count.
29. As a viewer, I want offline rail items to use a muted style, so that live Channels remain prominent.
30. As a viewer, I want the rail control at the top of the rail, so that the control is next to the panel it changes.
31. As a viewer, I want my expanded or collapsed rail choice saved in the browser, so that later pages keep my preference.
32. As a mobile viewer, I want a header control that opens the channel list from the left, so that the rail does not reduce the video width.
33. As a mobile viewer, I want the channel list to close after I select a Channel, so that the selected Channel becomes visible.
34. As a viewer, I want the watch workspace to use the full window width, so that the player can use all space between the side panels.
35. As a viewer, I want the player to have square edges and no decorative frame on desktop, so that it joins the watch workspace cleanly.
36. As a viewer, I want chat attached to the right side on a wide live watch page, so that the layout resembles Twitch.
37. As a viewer, I want chat to remain visible while the center content scrolls, so that the viewing layout stays stable.
38. As a viewer, I want chat to fill the window below the header, so that its disabled composer remains at the bottom.
39. As a viewer, I want the chat panel to state that chat is coming soon, so that the interface does not imply that chat works.
40. As a viewer, I want the chat composer disabled until chat exists, so that I cannot enter a message that the application will discard.
41. As a viewer, I want chat to appear only for a live Channel, so that offline pages do not contain a dead panel.
42. As a viewer, I want to close chat, so that the player can use the released width.
43. As a viewer, I want to reopen chat from the header, so that I can restore the normal watch layout.
44. As a viewer, I want my chat choice saved in the browser, so that later live watch pages keep my preference.
45. As a viewer, I want the player to expand immediately when I close chat or collapse the channel rail, so that no empty gap remains.
46. As a viewer on a narrow screen, I want chat below the player instead of beside it, so that chat does not squeeze the video.
47. As a viewer on a narrow screen, I want the below-player chat section collapsed at first, so that the video and Channel details appear first.
48. As a viewer, I want a theater-mode control in the player controls, so that I can focus on video and chat.
49. As a viewer in theater mode, I want the header, channel rail, Channel details, and footer hidden, so that video and chat use the window.
50. As a viewer in theater mode, I want an overlay control to restore closed chat, so that hiding the header does not trap the chat choice.
51. As a viewer, I want to leave theater mode from the player controls, so that I can restore normal navigation.
52. As a viewer, I want a new watch page to start in normal mode, so that theater mode does not hide navigation after a reload or Channel change.
53. As a viewer, I want the home page to start with live Channels, so that I can reach active content without reading an introduction.
54. As a viewer, I want a separate offline section below live Channels, so that every Channel remains available.
55. As a viewer, I want the home page to remove the large introduction, so that Channel cards appear higher on the page.
56. As a viewer, I want the home page to remove management shortcut cards, so that the page focuses on Channels.
57. As a viewer, I want each Channel card to show a 16:9 poster when one is available, so that I can identify the Channel visually.
58. As a viewer, I want a stable accent-colored poster fallback when no poster is available, so that every card has a media area.
59. As a viewer, I want circular Channel owner initials below each poster, so that the card resembles Twitch without requiring profile images.
60. As a viewer, I want each card to show the Channel title, Channel owner, live state, and viewer count when live, so that I can choose a Channel before opening it.
61. As a viewer, I want offline cards to keep the live-card size but use muted poster and text styles, so that the two sections remain consistent.
62. As a viewer, I want Channel states and viewer counts to continue to update without a page reload, so that the directory remains current.
63. As a viewer, I want Channel identity, viewer count, and Share visible below the player, so that common information and actions remain easy to find.
64. As a viewer, I want playback modes and diagnostics in a compact settings section, so that technical controls do not dominate Channel details.
65. As a viewer of an offline Channel, I want playback modes and diagnostics hidden, so that the page does not offer controls that have no effect.
66. As a viewer of an offline Channel, I want the existing poster, offline message, Channel identity, description, and Share action to remain, so that the page remains useful.
67. As a viewer, I want the application version below the Channel details, so that the required footer remains available without spanning the side panels.
68. As a viewer in theater mode, I want the version footer hidden, so that it does not reduce the viewing area.
69. As a keyboard user, I want every panel, menu, drawer, and theater control to have an accessible name and visible focus state, so that I can use the interface without a pointer.
70. As a viewer at 320 pixels wide, I want no horizontal document overflow, so that the interface remains usable on a small phone.

## Implementation Decisions

- This work refines the implemented Twitch-style layout. It does not replace the existing channel directory, player, playback run, or channel-status update flow.
- The full signed-in viewer experience receives the shared visual treatment. Administration, account, statistics, authentication, and OBS setup keep centered task content and existing behavior.
- The header spans the viewport on every page and remains pinned to the top. Its target height is about 50 pixels, with about 16 pixels of horizontal edge padding.
- The header shows the FrankerzSpam brand on the left. It shows My channel for a Channel owner and an account-initial control on the right. Statistics, Admin when authorized, and Sign out move into the account menu.
- The header has no search field. The channel rail provides Channel navigation.
- Keep the current FrankerzSpam pink accent and dark theme. Do not copy Twitch logos, names, type assets, or purple brand color.
- Remove ambient background glows. Replace raised, rounded workspace panels with flat dark surfaces and thin separators. Keep rounded controls only where their shape communicates interaction.
- Use Radix primitives for the account menu, collapsed-rail tooltips, and mobile channel drawer. Add the relevant Radix package if the installed packages do not cover a required interaction.
- The channel rail appears on home and watch pages. It does not appear on administration, account, statistics, authentication, or OBS setup pages.
- The expanded channel rail is about 240 pixels wide. The collapsed rail is about 64 pixels wide. The rail sits below the sticky header, touches the left viewport edge, fills the remaining viewport height, and scrolls independently.
- The rail contains every Channel. It groups live Channels first and offline or unavailable Channels second. Live Channels sort by viewer count from highest to lowest, then by title. Other Channels sort by title.
- The rail uses circular owner initials because the data model has no profile-image field. The existing Channel accent color supplies a stable background. Collapsed items expose the Channel title, Channel owner, live state, and viewer count through accessible tooltips.
- The rail starts expanded on a wide first visit. At narrower desktop widths it collapses to icons before chat moves or hides. The expanded or collapsed choice persists in browser storage and applies on both home and watch pages.
- On phone and narrow tablet layouts, replace the pinned rail with a left-side drawer. A header control opens the drawer. Channel selection closes it.
- The normal live watch layout has three regions below the header. The pinned channel rail is on the left, the flexible player and details column is in the center, and the pinned chat panel is on the right.
- The chat panel remains about 340 pixels wide when it is beside the player. It fills the remaining viewport height and keeps its disabled composer at the bottom.
- Chat remains an honest placeholder. It contains no fake messages and no transport, persistence, presence, moderation, or message submission.
- The chat panel appears only when the watched Channel is live. A close control hides it. A header control restores it. The chat choice persists in browser storage.
- When available width cannot support the player and both side panels, first collapse the channel rail. At a narrower content-driven breakpoint, replace the pinned rail with its drawer and move chat below the player. The below-player chat starts collapsed.
- Use representative browser widths of 1440, 1024, and the existing Pixel 7 profile to fix responsive regressions. The implementation can tune the exact CSS breakpoint if these three states remain stable and the page has no horizontal overflow.
- Closing chat or collapsing the channel rail reallocates the released width to the center column. Do not leave a placeholder grid track or empty gap.
- Add theater mode through the player control interface. Theater mode uses the full viewport for video and chat. It hides the global header, channel rail, Channel details, and footer.
- Theater mode includes player-overlay controls to leave theater mode and restore chat. Theater mode does not persist after navigation or reload.
- The player uses square edges without a decorative frame in desktop and theater layouts. Preserve the media aspect ratio and existing player behavior.
- The home page removes the large introduction and management shortcut cards. Header and account-menu actions replace the shortcuts.
- The home page has separate live and offline sections. An unavailable Channel appears in the second section with its accurate Unavailable state.
- Home cards retain a 16:9 poster area. Use the current poster when available. Otherwise, use the existing accent color with a title initial. Add circular owner initials to the metadata row.
- Live and offline cards use the same size. Offline cards mute the poster and secondary text. Every card remains a single link to its watch page.
- Channel status updates continue to use the existing real-time update flow and polling fallback. This work does not add another status source.
- The normal live details area keeps Channel identity, viewer count, description, and Share visible. Playback modes and diagnostics move into one compact settings disclosure.
- The offline page keeps the player poster and automatic status checking. It also keeps Channel identity, description, and Share. Hide playback modes, diagnostics, and chat while offline.
- The version footer stays below the center Channel details. Hide it in theater mode. On other pages, retain the centered footer placement.
- Keep transport actions inside the HLS and WebRTC adapters. Keep cross-protocol selection in the playback-mode module. Do not change pause handling, progress detection, recovery eligibility, or the streaming contract.
- No database schema or public server interface changes are required. Use existing Channel poster, accent color, title, owner name, status, and viewer-count data.

## Testing Decisions

- Good tests assert what a viewer can see or do. They do not assert private state, CSS class names, or internal module structure.
- The main test seam is the rendered viewer experience in the existing Playwright flow. It exercises the application through accessible roles and real browser layout.
- Desktop browser tests verify that the header spans the viewport and remains at the top after document scrolling.
- Desktop browser tests verify that the channel rail touches the left edge, chat touches the right edge, and both remain below the header during center-column scrolling.
- Browser geometry tests use element bounds and viewport bounds. They do not inspect the names of CSS rules.
- Browser interaction tests collapse and expand the channel rail, close and restore chat, and verify that the player receives the released width.
- Browser persistence tests reload or navigate between home and watch pages. They verify the saved channel-rail and chat choices.
- Browser tests enter and leave theater mode. They verify the visible regions, the player-overlay chat control, and the reset to normal mode after navigation or reload.
- Responsive browser tests cover 1440-pixel desktop width, 1024-pixel narrow desktop width, and the existing Pixel 7 project. They verify the expected rail, drawer, chat, and player states.
- Mobile browser tests open the channel drawer, select a Channel, and verify that the drawer closes. They also verify the collapsed below-player chat section for a live Channel.
- Home browser tests verify separate live and offline sections, their ordering, Channel navigation, and the absence of the old introduction and management cards.
- Header browser tests cover an ordinary viewer and the existing administrator who owns a Channel. They verify visible actions and account-menu actions by role.
- Add approved Playwright screenshots for stable home, normal watch, theater watch, and mobile watch states. Mask or replace changing video imagery, viewer counts, and timestamps so that snapshots compare the interface rather than live data.
- Keep focused component render tests for offline Channel behavior, unavailable status, role combinations, menu accessibility, settings disclosure, and chat absence. These states are more costly to arrange through the browser fixture.
- Keep pure model tests for Channel grouping and ordering. The tests cover viewer-count ties, title ties, offline Channels, and unavailable Channels.
- Extend the current tests for browser-storage preferences instead of adding a new state adapter only for tests.
- Keep the existing Playwright and Vitest tools. Do not add another test runner.
- Run accessibility queries through roles and labels. Verify focus return after the account menu and mobile drawer close.
- Keep the existing 320-pixel overflow check and extend it to home, live watch, and offline watch states.

## Out of Scope

- Working chat, including message transport, message history, presence, moderation, emotes, and notifications.
- Channel search, global search, recommendations, categories, follows, subscriptions, and discovery feeds.
- Profile-image upload or storage. The interface uses generated initials.
- A light theme or theme switch.
- Twitch trademarks, logos, purple brand tokens, proprietary icons, or copied text.
- New Channel metadata fields, database migrations, or public server interface changes.
- Changes to playback selection, playback runs, pause behavior, recovery, buffering, HLS timing, WebRTC transport, or the streaming contract.
- Functional redesigns of administration, account, statistics, authentication, or OBS setup.
- Picture-in-picture, a persistent mini-player, pop-out chat, or swipe navigation between Channels.
- Real-time changes beyond the current Channel status and viewer-count update flow.

## Further Notes

- This spec builds on the implemented Twitch-style layout issue. That work introduced the card grid, three-column watch page, chat placeholder, channel rail, and saved rail preference.
- The current source already uses approximately 240 pixels for the expanded rail, 64 pixels for the collapsed rail, and 340 pixels for chat. The main layout change removes the centered page caps and pins the side panels to the viewport.
- The present UI inventory is stale. It says that the application has no footer and describes home sections that no longer render. Update the inventory when implementation makes the new interface the current state.
- The design discussion did not change a domain term or make a hard-to-reverse architecture choice. No glossary or ADR update is required.
