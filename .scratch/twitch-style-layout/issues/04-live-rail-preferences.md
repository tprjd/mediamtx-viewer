# 04: Live rail preferences

**What to build:** The Live rail becomes user-configurable chrome: it collapses to a thin icon rail, defaults to expanded, persists the viewer's choice across visits, auto-collapses on narrower desktops, and can be hidden completely from a header toggle.

**Blocked by:** 03: Live rail

**Status:** resolved

- [x] The rail collapses to a thin icon rail of channel initials and expands back to the full list
- [x] The rail is expanded by default on first visit
- [x] The choice (expanded, collapsed, or hidden) persists across visits via localStorage
- [x] Below 1280px the rail auto-collapses to the icon rail; at full width the persisted choice applies
- [x] A header toggle button, visible only on the watch page, hides the rail completely; the choice persists
- [x] Preference behavior is covered by render tests (collapsed/expanded forms, persistence, header toggle)

## Comments

Implemented in commit `e372f59`. The feature flow was verified before this ticket was resolved.
