# Radix UI audit

Date: 2026-09-10

## Result

The project has four direct Radix dependencies, not two. It uses those packages
in six source files. The project has one shared Radix wrapper,
`components/ui/tooltip.tsx`. The other use sites compose Radix parts directly
([`components/ui/tooltip.tsx:1-28`](../components/ui/tooltip.tsx#L1-L28)).

The first migration should add one Alert Dialog pattern for destructive actions.
The next migrations should use Radio Group for playback-mode selection and the
installed Collapsible package for playback diagnostics. Tooltip and Toast can
then standardize help text and copy feedback.

This audit does not recommend a Radix replacement for each native control. The
native checkbox, `details` element, navigation links, and Vidstack volume slider
already fit their jobs.

## Scope and method

The scan covered `app/**/*.tsx`, `components/**/*.tsx`, their CSS modules, and
their component tests. It also checked `package.json` and `package-lock.json`.
The search included dialogs, alerts, disclosures, menus, popups, tooltips,
selects, tabs, binary controls, checkboxes, context menus, sliders, transient
messages, ARIA state, and positioned overlays.

The ranking uses five factors:

- **Accessibility risk** measures focus, keyboard, name, role, and announcement
  problems in the current control.
- **Repeated code** measures how many implementations need the same behavior.
- **Behavior complexity** measures how much interaction code the project owns.
- **Reuse** measures how many current or likely use sites can share the pattern.
- **Migration cost** includes client boundaries, server-action composition,
  styling, and test changes.

Only repository source and official Radix documentation support the findings.

Use these commands to regenerate the Radix use-site list and the native HTML
`title` count:

```sh
rg -l '@radix-ui/' app components --glob '*.{ts,tsx}' | sort
rg -n '\btitle=' app components --glob '*.tsx' --glob '!*.test.tsx' \
  | rg -v '<ShareButton title=' \
  | wc -l
```

## Current Radix inventory

The manifest and lockfile agree on these four direct packages
([`package.json:24-27`](../package.json#L24-L27),
[`package-lock.json:1880-1883`](../package-lock.json#L1880-L1883),
[`package-lock.json:1966-1969`](../package-lock.json#L1966-L1969),
[`package-lock.json:2045-2048`](../package-lock.json#L2045-L2048),
[`package-lock.json:2325-2328`](../package-lock.json#L2325-L2328)).

| Package | Locked version | Current use |
| --- | ---: | --- |
| `@radix-ui/react-collapsible` | 1.1.20 | The narrow-layout Chat disclosure and playback-settings disclosure in [`components/channel-viewer.tsx:83-140`](../components/channel-viewer.tsx#L83-L140) and [`components/channel-viewer.tsx:144-197`](../components/channel-viewer.tsx#L144-L197) |
| `@radix-ui/react-dialog` | 1.1.23 | The Channel drawer in [`components/channel-navigation.tsx:37-80`](../components/channel-navigation.tsx#L37-L80) and stream-key rotation confirmation in [`components/auth/stream-key-manager.tsx:111-153`](../components/auth/stream-key-manager.tsx#L111-L153) |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | The account menu in [`components/auth/user-menu.tsx:38-95`](../components/auth/user-menu.tsx#L38-L95) |
| `@radix-ui/react-tooltip` | 1.2.16 | Collapsed Channel links in [`components/live-rail.tsx:62-120`](../components/live-rail.tsx#L62-L120) and the shared wrapper used by the share button in [`components/ui/tooltip.tsx:1-28`](../components/ui/tooltip.tsx#L1-L28) and [`components/share-button.tsx:32-47`](../components/share-button.tsx#L32-L47) |

The existing Radix controls have useful behavior tests. The tests check account
menu roles and focus return, Channel drawer focus return, Collapsible state, and
keyboard-focus tooltips
([`components/auth/user-menu.test.tsx:16-77`](../components/auth/user-menu.test.tsx#L16-L77),
[`components/channel-navigation.test.tsx:60-99`](../components/channel-navigation.test.tsx#L60-L99),
[`components/channel-viewer.test.tsx:255-308`](../components/channel-viewer.test.tsx#L255-L308),
[`components/live-rail.test.tsx:105-190`](../components/live-rail.test.tsx#L105-L190)).

### Shared component coverage

`components/ui/tooltip.tsx` is the only shared component that wraps a Radix
package. It fixes one visual style and one delay, but it creates a Provider for
each tooltip and has no placement or rich-content options
([`components/ui/tooltip.tsx:6-26`](../components/ui/tooltip.tsx#L6-L26)). The
Live Rail therefore builds a second Tooltip composition and Provider
([`components/live-rail.tsx:97-120`](../components/live-rail.tsx#L97-L120),
[`components/live-rail.tsx:200-239`](../components/live-rail.tsx#L200-L239)).

Direct composition is not a defect by itself. A shared component is useful when
it centralizes repeated presentation or an important behavior rule. It must
still expose the Radix parts that a drawer, form, or rich tooltip needs. Radix
documents custom Dialog and Toast APIs as supported composition patterns in the
[Dialog documentation](https://www.radix-ui.com/primitives/docs/components/dialog#custom-apis)
and [Toast documentation](https://www.radix-ui.com/primitives/docs/components/toast#custom-apis).

## Ranked migrations

| Priority | Candidate | Radix package | Accessibility risk | Repeated code | Behavior complexity | Reuse | Migration cost |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 0 | Destructive confirmations | `@radix-ui/react-alert-dialog` | High | Medium | High | High | Medium |
| 1 | Playback-mode selection | `@radix-ui/react-radio-group` | Medium | Low | Medium | Low | Medium |
| 1 | Playback diagnostics disclosure | Installed `@radix-ui/react-collapsible` | Medium | Medium | Medium | Medium | Low |
| 2 | Help text and native `title` attributes | Installed `@radix-ui/react-tooltip` | Medium | High | Medium | High | Medium to high |
| 2 | Copy success and failure feedback | `@radix-ui/react-toast` | Medium | High | Medium | High | Medium |
| 3 | Secondary administrator actions | Installed `@radix-ui/react-dropdown-menu` | Low | Medium | Low | Medium | Medium |

### Priority 0: standardize destructive confirmations

Use `@radix-ui/react-alert-dialog` for actions where the user must confirm an
important or broad effect. Radix defines Alert Dialog as a modal that expects a
response. It traps focus, announces its title and description, supports Escape,
and returns focus to its trigger. See the official
[Alert Dialog features and keyboard behavior](https://www.radix-ui.com/primitives/docs/components/alert-dialog#features).

The current patterns are inconsistent:

- **Clear activity** uses `window.confirm` before it permanently deletes all
  activity records
  ([`components/admin/clear-activity-control.tsx:20-35`](../components/admin/clear-activity-control.tsx#L20-L35)).
- **Rotate stream key** uses a normal Dialog even though the action immediately
  revokes the current stream key
  ([`components/auth/stream-key-manager.tsx:111-153`](../components/auth/stream-key-manager.tsx#L111-L153)).
- **Disconnect current broadcast** immediately disconnects the publisher and
  all viewers, with no confirmation
  ([`app/account/channel/page.tsx:166-171`](../app/account/channel/page.tsx#L166-L171)).
- **Account and channel administration** has direct forms for disabling an
  account, rejecting a registration, revoking all sessions, and disabling a
  channel
  ([`app/admin/users/page.tsx:95-126`](../app/admin/users/page.tsx#L95-L126),
  [`app/admin/users/page.tsx:167-190`](../app/admin/users/page.tsx#L167-L190)).

Create one project-level Alert Dialog composition with required `title`,
`description`, cancel text, and action text. Keep server-action forms as the
source of the mutation. The shared component must allow the action button to
remain a submit control. Radix documents `AlertDialog.Action` and
`AlertDialog.Cancel` as separate controls and documents controlled use with a
form in the
[Alert Dialog API](https://www.radix-ui.com/primitives/docs/components/alert-dialog#api-reference).

Do not confirm every action. Keep activation, granting streaming access, reset
link creation, and one-session revocation direct unless product policy requires
confirmation. Confirmation on each small action makes the important warnings
less distinct.

### Priority 1: make playback mode a Radio Group

Use `@radix-ui/react-radio-group` for the four playback modes. The current
control is a labelled plain `div` with four independent buttons. Each button
owns its own `aria-pressed` state and click handler
([`components/live-player.tsx:51-119`](../components/live-player.tsx#L51-L119)).
Only one playback mode can be active, and selecting it changes the playback run.

Radio Group represents an exclusive choice directly. Radix manages the checked
state, disabled items, a roving tab stop, and arrow-key selection. See the
official [Radio Group accessibility behavior](https://www.radix-ui.com/primitives/docs/components/radio-group#accessibility).
Keep the existing button-like appearance by styling `RadioGroup.Item` from its
`data-state` attribute.

The current tests cover clicks, pressed state, unavailable modes, and saved
selection. They do not cover arrow-key selection or a group role
([`components/live-player.test.tsx:101-143`](../components/live-player.test.tsx#L101-L143)).
The migration must add those checks. It must also preserve the existing
cross-protocol selection
([`components/use-playback-mode.ts:115-149`](../components/use-playback-mode.ts#L115-L149)).

`@radix-ui/react-toggle-group` is a possible visual match, but Radio Group is
the better semantic match. A playback mode is one required choice, not a set of
buttons that users can toggle off. Radix defines Radio Group as a set where no
more than one item is checked. Radix defines Toggle Group as a set of two-state
buttons. See the official [Radio Group](https://www.radix-ui.com/primitives/docs/components/radio-group)
and [Toggle Group](https://www.radix-ui.com/primitives/docs/components/toggle-group)
descriptions.

### Priority 1: replace the hand-built playback diagnostics disclosure

Use the installed `@radix-ui/react-collapsible` package in `PlaybackStats`.
The current control owns `useState`, `useId`, `aria-controls`, `aria-expanded`,
and a `hidden` content element
([`components/playback-stats.tsx:698-758`](../components/playback-stats.tsx#L698-L758)).
The CSS also depends on the handwritten ARIA and `hidden` states
([`components/playback-stats.module.css:69-88`](../components/playback-stats.module.css#L69-L88)).

This migration removes local disclosure wiring and makes playback diagnostics
match the two existing Collapsible controls. Radix Collapsible implements the
Disclosure pattern and supplies open and closed data attributes. See the
official [Collapsible accessibility and API](https://www.radix-ui.com/primitives/docs/components/collapsible#accessibility).
The current test already checks the visible state and `aria-controls`, so the
migration cost is low
([`components/playback-stats.test.tsx:128-144`](../components/playback-stats.test.tsx#L128-L144)).

### Priority 2: use one Tooltip composition for help text

The source has 36 native HTML `title` attributes. Twenty-three are in playback
diagnostics, and seven are in Vidstack controls
([`components/playback-stats.tsx:698-962`](../components/playback-stats.tsx#L698-L962),
[`components/vidstack-player.tsx:93-175`](../components/vidstack-player.tsx#L93-L175)).
Other app-owned icon buttons also use `title`
([`components/channel-viewer.tsx:53-81`](../components/channel-viewer.tsx#L53-L81),
[`components/live-rail.tsx:207-232`](../components/live-rail.tsx#L207-L232)).

Radix Tooltip opens for both keyboard focus and pointer hover. See the official
[Tooltip description and Provider API](https://www.radix-ui.com/primitives/docs/components/tooltip).
Move the Provider to one shared client boundary. Extend the shared Tooltip to
support placement and rich content. Then move the direct Live Rail composition
to the shared API.

Do not wrap each diagnostic cell as a non-focusable trigger. Put the explanation
on a labelled help control or make the explanation visible. A Tooltip trigger
must have a useful keyboard focus target. For Vidstack controls, keep the
existing `aria-label` values and remove duplicate `title` values unless a
visible tooltip adds value. Vidstack already owns the media-control and volume
slider behavior
([`components/vidstack-player.tsx:93-175`](../components/vidstack-player.tsx#L93-L175)).

### Priority 2: standardize transient copy feedback

Use `@radix-ui/react-toast` if the product needs consistent success and failure
messages. Six copy actions now change their button text or tooltip text. They do
not share an announcement region or an error pattern
([`components/auth/stream-key-manager.tsx:39-104`](../components/auth/stream-key-manager.tsx#L39-L104),
[`components/share-button.tsx:13-46`](../components/share-button.tsx#L13-L46),
[`components/playback-stats.tsx:689-695`](../components/playback-stats.tsx#L689-L695),
[`components/playback-stats.tsx:981-997`](../components/playback-stats.tsx#L981-L997)).

Radix Toast supplies an announcement region, timeout behavior, focus pausing,
and a viewport. User-action results can use the `foreground` type. See the
official [Toast features and accessibility guidance](https://www.radix-ui.com/primitives/docs/components/toast#accessibility).
Use Toast for feedback only. Radix states that a Toast must not stay open to
collect a required response. Keep confirmations in Alert Dialog.

This migration has value only if it also reports clipboard failures. A success
toast alone gives a different visual treatment without fixing the silent error
paths.

### Priority 3: consider a Dropdown Menu for secondary administrator actions

Each account card can show several small action forms in one row
([`app/admin/users/page.tsx:95-126`](../app/admin/users/page.tsx#L95-L126)). The
installed Dropdown Menu can group secondary actions and already supplies focus
management, keyboard navigation, and typeahead. See the official
[Dropdown Menu features](https://www.radix-ui.com/primitives/docs/components/dropdown-menu#features).

Keep the primary state-changing action visible. Move only lower-frequency
actions if the current row does not fit at supported widths. This change has no
clear accessibility defect to fix, so it stays below the other migrations. If
the row fits and users need fast administration, keep the visible buttons.

## Controls that should stay native or domain-specific

### Discord notification checkbox

The checkbox is inside a `label`, participates in a server-action form, and has
a separate save button
([`app/account/channel/page.tsx:130-143`](../app/account/channel/page.tsx#L130-L143)).
Keep the native checkbox. It makes the deferred save action clear and works
without client state.

`@radix-ui/react-switch` is valid only if the design changes to a switch and the
team preserves the separate save model. Radix Switch renders a hidden form input
when it is inside a form and implements switch keyboard behavior. See the
official [Switch API](https://www.radix-ui.com/primitives/docs/components/switch#api-reference).
An autosaving switch would be a separate behavior change, not UI
standardization.

### Administrator session disclosure

The session list uses native `details` and `summary`
([`app/admin/users/page.tsx:129-144`](../app/admin/users/page.tsx#L129-L144)).
Keep it native while the disclosure is uncontrolled and needs no animation or
shared state. Moving it to the installed Collapsible package would add client
code without fixing a current problem.

### Channel rail width control

The Channel rail button changes between a compact navigation rail and a full
navigation rail. It does not hide one panel
([`components/live-rail.tsx:155-239`](../components/live-rail.tsx#L155-L239)).
Keep the native button and preference hook. Collapsible is not a good match for
a layout-width preference that leaves the Channel links available.

### Statistics range links

The metric range control uses links and stores the range in the URL
([`app/statistics/page.tsx:316-333`](../app/statistics/page.tsx#L316-L333)). Keep
the navigation links. Tabs describe layered panels in one interface, while
these links request distinct URL states.

### Vidstack volume slider and media buttons

The player uses Vidstack's `VolumeSlider`, `PlayButton`, `MuteButton`,
`LiveButton`, `PIPButton`, and `FullscreenButton`
([`components/vidstack-player.tsx:93-175`](../components/vidstack-player.tsx#L93-L175)).
Keep these controls. Replacing the volume control with
`@radix-ui/react-slider` would split media behavior between two component
systems and add synchronization code.

## Patterns not present

The scan found no app-owned Select, Tabs, Accordion, Popover, Context Menu,
Menubar, or general-purpose Slider implementation. It also found no second
custom modal outside the Radix Dialog sites. Do not add those packages until a
real control needs them.

The app has alerts and status messages, but these are inline page feedback, not
temporary popups. Keep `role="alert"` for errors and `role="status"` for status
updates unless a product requirement calls for a temporary Toast
([`components/auth/login-form.tsx:50-81`](../components/auth/login-form.tsx#L50-L81),
[`components/auth/change-password-form.tsx:45-63`](../components/auth/change-password-form.tsx#L45-L63)).

## Recommended delivery order

1. Add a shared Alert Dialog composition and migrate clear activity, stream-key
   rotation, and disconnect current broadcast.
2. Extend the Alert Dialog use to the broad administrator actions after the
   first behavior and form-submission tests pass.
3. Migrate playback-mode selection to Radio Group.
4. Migrate playback diagnostics to the installed Collapsible package.
5. Consolidate the Tooltip Provider and wrapper, then replace the diagnostic
   help text that currently depends on `title`.
6. Add Toast only with one shared success and failure API for copy actions.
7. Change the administrator action row only if a responsive UI check shows that
   the row needs a menu.

This order fixes the highest-risk interactions first. It also uses the installed
packages before it adds more dependencies.
