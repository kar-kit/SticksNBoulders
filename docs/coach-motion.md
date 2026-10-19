# Coach-side motion

_Design note, 16 Oct 2026. Joey's ticket: animate the coach pages (Roster,
Review Queue, Athlete View, Programs, Program Editor). The athlete's phone
screens are out of scope and unchanged._

Joey's rules, in priority order, and how each is met:

1. **Tailwind first.** Every motion is a Tailwind utility, keyframe or theme
   token defined once in `app/globals.css`. No animation library was added.
   The only script is `components/ui/motion.ts`, for the four things CSS
   cannot know about React (below).
2. **Interactions first.** Every row in the table below says what the motion
   tells the coach. Nothing loops except loading skeletons.
3. **Then quality of life:** saved / refused tints on cells, optimistic line
   insert and
   removal, skeletons, the landing tint.

Guardrails: transform and opacity only for anything that moves; colour
transitions on controls (paint, never layout; `button.tsx` already did this);
routine motion ≤ 180 ms, dialogs and the drawer 240 ms; every hover state is
mirrored on `focus-visible`; reduced motion makes all of it instant.

## Tokens (`app/globals.css`, `@theme static`)

| Token | Value | Used for |
| --- | --- | --- |
| `ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | anything arriving or answering |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | anything leaving |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | a selection rule moving between two places |
| `duration-press` | 90 ms | the press |
| `duration-quick` | 120 ms | hover, focus, colour, popups |
| `duration-base` | 180 ms | rows, panels, views arriving or leaving |
| `duration-panel` | 240 ms | dialogs, the context drawer |
| `duration-linger` | 400 ms | the saved / refused / landed tint. Opacity only, never blocks input. Was 900 ms; Joey cut it on review (decision 4) |
| `animate-rise-in` | opacity + 4 px lift, base | something new: a row, a panel, a confirm |
| `animate-fade-in` | opacity, base | data replacing a skeleton or "Loading…"; table rows |
| `animate-pop-in` | opacity + scale 0.97, quick | popups anchored to a trigger |
| `animate-drawer-in` / `-out` | opacity + 12 px slide, panel / base | the context drawer |
| `animate-row-out` | opacity to 0, base | a line leaving ahead of the server |
| `animate-dim` | opacity to 0.4, base | a day, week or block being removed |
| `animate-flash` | opacity 0 → 1 → 0, linger | the tint behind `flash-host` |
| `animate-shimmer` | slide, 1.4 s loop | skeletons, `motion-safe` only |

Utilities: `transition-control` (the control transition: colour, opacity,
scale, translate, rotate at `quick`), `press` / `press-wide` (scale 0.97 /
0.99 on `:active`, `motion-safe` only), `rule-b` / `rule-l` + `rule-on` (the
2 px accent selection rule, grown in with `scale`), `flash-host` (the tint
overlay on a `::after`, driven by `data-flash`).

The `ease-*` and `animate-*` namespaces are cleared first, as the colour and
type namespaces already were, so Tailwind's own curves and spin/ping/bounce
cannot drift into use.

**Gating shared components.** `@custom-variant coach` matches only inside the
coach shell (`.coach-scale`). `Button`, `TextField` and `ExerciseTypeahead`
are also the athlete's, so their motion classes are all `coach:`-prefixed;
`components/ui/coach-gate.test.tsx` fails if a bare motion class ever lands on
them. `Dialog`, `Menu` and `Tabs` are used only on coach screens (and the
`/design` sheet).

## Every interaction animated

| # | Interaction | Component | What the motion says |
| --- | --- | --- | --- |
| 1 | Hover / keyboard focus on any coach button | `ui/button.tsx` (`coach:`) | "this is what Enter or a click will hit": fill or text eases in, mirrored on focus-visible |
| 2 | Pressing a button, chip, menu trigger, row link | `press` / `press-wide` everywhere | "it took the press": a 3% (1% on wide rows) give under the pointer or key |
| 3 | Opening a ⋯ menu | `ui/menu.tsx` | it came from this trigger: pops from the trigger's corner |
| 4 | Hover / focus on menu items | `ui/menu.tsx` | where Enter lands |
| 5 | Switching Calendar / Week / Progression | `ui/tabs.tsx`, `program-editor.tsx` | the selection moved: the 2 px rule grows under the new tab as the old one shrinks; the new view fades in |
| 6 | Switching block in the progression view | `program-progression.tsx` | same tab rule; the grid crossfades |
| 7 | Choosing a week in the outline (click or Up/Down) | `program-outline.tsx` | the accent rule grows down the selected week; its days rise in |
| 8 | Opening a day from the calendar | `program-editor.tsx` landing | you landed here: instant scroll, the day card tints accent and fades |
| 9 | Landing from a clip ("Adjust program") | `program-editor.tsx` landing | the traced line's cells tint accent and fade |
| 10 | Exercise typeahead opening | `exercise-typeahead.tsx` (`coach:`) | the list belongs to this field: pops down from it |
| 11 | Arrow keys in the typeahead | `exercise-typeahead.tsx` (`coach:`) | where Enter will land: the accent rule follows the active option |
| 12 | Adding a line | `program-editor.tsx` | it is there now: the row fades in at once as a pending placeholder ("saving", `aria-busy`), with the keyboard on its Sets cell, before the server answers. See "Adding a line" below |
| 13 | Removing a line | `program-editor.tsx` | it is going now: the row fades at once and leaves the grid when the fade ends, before the server answers; a refusal puts it back with the error |
| 14 | Adding a day (+ Day, calendar + Day) | `program-editor.tsx`, `program-calendar.tsx` | the new day card rises in; on the calendar the day rises into its cell |
| 15 | Removing a day | `program-editor.tsx` | in flight: the card dims and stops taking input until the tree comes back without it; restored if refused |
| 16 | Adding a week (+ Week, Duplicate, Duplicate with a bump) or a block | `program-outline.tsx` | the new week or block rises in where it landed in the outline |
| 17 | Removing a week or block | `program-outline.tsx`, `program-editor.tsx` | in flight: dimmed in the outline and on the page |
| 18 | Publish / Unpublish a week | `program-outline.tsx` `StateMark`, `program-editor.tsx` `WeekMeta`, `ui/button.tsx` | it changed state: the button's fill crossfades primary ↔ secondary, the state mark pops (outline, calendar, progression), the dates line rises with Draft / Live |
| 19 | A cell saved | `program-editor.tsx`, `program-progression.tsx` | the server has it: a green tint over the cell, fading |
| 20 | A cell refused (invalid, or the server said no) | same | it did not save: a red tint, and the reason rises in under the cell |
| 21 | A percentage's kilos after a max is saved ("Add one") | `load-preview.tsx` | the kilos line rises in with its new text; the cell tints saved |
| 22 | Any load preview changing (an edit) | `load-preview.tsx` | the kilos moved: the new line rises |
| 23 | Opening "Add one" | `load-preview.tsx` | the kg field rises in under the line |
| 24 | Context drawer open / close | `program-context.tsx` | where it lives: slides in from the right edge, and back out; already hidden from assistive tech while it slides |
| 25 | Duplicate with a bump… | `bump-week.tsx` | rises in under the week header it came from |
| 26 | Copy to… | `copy-program.tsx` | rises in; "Copied" and errors rise in |
| 27 | Remove … confirm strip | `program-editor-parts.tsx` | the question belongs to this thing: rises in beside it |
| 28 | Editor error banner | `program-editor.tsx` | something just went wrong: rises in (again on a new message) |
| 29 | Weekday chips | `program-editor.tsx` | the fill eases to the chosen day |
| 30 | Calendar: hover / focus a day; "+ Day" in an empty cell | `program-calendar.tsx` | which day; "+ Day" fades up under the pointer or keyboard |
| 31 | Grid cell focus (week and progression), inline names, start date | `program-editor*.tsx` | the border eases to accent |
| 32 | Editor loading | `program-editor.tsx` `EditorSkeleton` | the page's shape, with a sheen, instead of a blank screen |
| 33 | Bodyweight dialog open / close | `ui/dialog.tsx`, `athlete-bodyweight.tsx` | over the page, not a new page: settles in from 98% and 4 px below over a fading backdrop; closes at once (page live, focus back) and fades out |
| 34 | Clip dialog open / close | `ui/dialog.tsx`, `athlete-videos.tsx` | same; the video fades up |
| 35 | Bodyweight / e1RM range chips | `athlete-bodyweight.tsx`, `athlete-lifts.tsx` | the fill eases to the chosen range |
| 36 | Load-suggestions gear | `suggestion-switch.tsx` | a setting being adjusted: the gear turns 45°, the caret flips, the panel pops under the control; Saving… fades, a refusal rises in |
| 37 | THIS BLOCK preview arriving | `athlete-program.tsx` | the panel filled: fades in over "Loading…" |
| 38 | Current maxes: edit, save, undo | `current-maxes.tsx` | the editor rises in the cell; the saved confirmation rises; the cell that changed tints saved |
| 39 | Lift tabs | `athlete-lifts.tsx` | tab rule moves; the lift's panel crossfades |
| 40 | Videos list | `athlete-videos.tsx` | rows answer hover / focus / press; "Show all" rows rise in |
| 41 | Recent sessions: expand a session | `athlete-sessions.tsx` | the sets rise out of the row they belong to |
| 42 | Selecting a clip in the Review Queue | `review-queue.tsx` | the rail rule moves to it; the clip's details crossfade; the video fades up |
| 43 | A clip arriving live, or put back by Undo | `review-queue.tsx` | it is new in the rail: rises in; Undo itself rises in |
| 44 | Player controls (speed, loop, frame) | `clip-player.tsx` | colour eases to the chosen speed; press |
| 45 | Roster | `roster.tsx` | the page fades in once loaded; Needs-you and table rows answer hover / focus |
| 46 | Programs list | `program-list.tsx` | skeleton, then a fade; rows answer hover / focus / press; New block form rises in |
| 47 | Coach nav and rail | `shell/coach-shell.tsx` | the active section's rule grows in; the Review count pops when it changes while the coach is elsewhere |

## Deliberately still

- **Page-to-page navigation.** No route transitions: not needed for now
  (Joey, review of PR #90, decision 5). For when it is revisited: a coach
  moves between Roster, Review and athletes dozens of times a session, so
  200 ms on every hop is a tax, and React's `<ViewTransition>` overlay
  swallows clicks mid-flight.
- **Scrolling.** The landing scroll is instant. A smooth scroll down a block
  is the motion most likely to make someone feel ill; the tint does the work.
- **Dismissals.** Menus, the typeahead list, confirm strips, the bump panel
  and collapsed session rows close at once. By then the coach has moved on,
  and an exit that lingers sits under the next click. Dialogs and the drawer
  are the exceptions because they cover or reshape the page.
- **Typing.** No per-keystroke motion in the grid. The bump preview's list of
  changed lines updates on every keystroke and is read while typing, so it is
  still.
- **Re-sorting the roster.** Animating a reorder (FLIP) needs every row
  measured in script; rule 1 says no, and in a ten-row table the new order and
  the ▲/▼ are feedback enough.
- **Layout.** Nothing animates height or width. A removed line fades, then its
  space closes in one step; an added line's placeholder opens its space in one
  step, then it
  fades in.
- **Charts** (e1RM, bodyweight) do not draw in. A line that animates from zero
  briefly shows a wrong number.
- **Text, headers, empty states, pills.** Not interactive, not changing.
- **Loading states that already said "Loading…"** (roster, queue, athlete
  panels) keep their text; skeletons replace only screens that were blank
  (editor, Programs).
- **The athlete side.** Untouched; see gating above.

## Adding a line (the placeholder row)

Joey's decision 1 on review: show an added line at once rather than after the
server's row id. `DayEditor.addLine` in `program-editor.tsx`:

- **At once:** a placeholder row (a `Prescription` with a client key for an
  id) joins the grid after the day's lines, fades in, says "saving", carries
  `aria-busy`, and takes the keyboard on its Sets cell -- so Add exercise,
  Enter, type the sets still works without waiting.
- **Nothing is written against a row that does not exist.** Its exercise swap
  and video toggle are disabled; anything typed into its other cells is held
  per cell and not sent. Alt+Up/Down will not move a line past it.
- **Claimed:** the editor writes the line, reads the tree back and, before
  showing that tree, hands the new id to the placeholder (`claim`). The held
  cells become ops, are folded into the tree in that same render, then sent.
  The real row reuses the placeholder's React key, so it is the same `<tr>`:
  no jump, the focus and the typed text stay. Its exercise cell tints saved.
- **Refused:** the placeholder fades out (as a removed line does) and the
  editor's error says why. What was held is dropped.
- **× before the id arrives:** the placeholder fades now; the line is removed
  the moment it exists, and never shows.
- **Two quick adds:** sent one after another, per day, so they land in the
  order typed, each placeholder in its place meanwhile.
- **Another write in flight:** adds do not take the editor's `busy` flag, so
  the coach keeps typing. [Inference] The read-back after an add can still
  land over a cell edit whose own save has not finished; that race predates
  this and applies to every structural write (`run` reads the tree back the
  same way). It shows the server's value until the edit's save lands.

Days, weeks and blocks are not done the same way. Not the same cheap change:
a day placeholder carries its date chips, notes and its own add field, and a
week or block is selected and navigated to; each would need its own pending
model. They still dim on removal and rise in on arrival.

## Reduced motion

Two layers. Every transform (lift, slide, scale, press, shimmer) is behind
`motion-safe:` or a `prefers-reduced-motion: no-preference` query, so nothing
moves. Under that, a floor in `globals.css`, scoped to `.coach-scale`, sets
every animation and transition inside the coach shell to 0.01 ms (not 0: an
animation of zero length fires no `animationend`, which the dialog and drawer
wait on). The result is instant: dialogs and the drawer open and close at
once, tints do not show, end states are reached immediately.

## The script that CSS cannot replace (`components/ui/motion.ts`)

| Helper | Why CSS cannot |
| --- | --- |
| `usePresence` | keeps a dialog or the drawer mounted after React would remove it, so its exit can play |
| `afterExit` | waits for the element's own `animationend` / `transitionend`, timed from its computed style; no millisecond lives in script |
| `useArrivals` | tells new rows from rows that were there on load, so a forty-cell grid does not rise in on every page load |
| `useChanged` | the same for a value (a week's state, a kilos line) |
| `flash` | replays a tint on an element that already played one |

The dialogs close semantically at once (`dialog.close()`, focus returned,
`aria-hidden`) and only the paint lingers: `display` and `overlay` are
transitioned with `allow-discrete`, the native way to fade a closed dialog out
of the top layer.

## Tests

- `components/ui/motion.test.tsx`: presence, arrivals, changes, flash,
  afterExit (waits for its own event, falls back to its computed duration).
- `components/ui/dialog.test.tsx`: a leaving dialog stays mounted while it
  fades, already closed, hidden and with focus back; unmounts at once with
  nothing to play; reopens mid-fade.
- `components/coach/program-editor.test.tsx` "motion": optimistic line removal
  and its refusal; the placeholder row (on screen and focused before the
  server answers, held cells sent once claimed in the same row, refusal fades
  it, × before the id removes it on arrival, two quick adds in order, no
  reorder past it); saved / refused tints, only added lines marked to arrive,
  the drawer kept through its exit, a day dimmed while its removal is in
  flight. `program-editor-landing.test.tsx`: the landing tint on the traced
  line.
- `components/ui/coach-gate.test.tsx`: shared components carry no motion
  outside the coach shell.
- `npm run e2e:coach-motion`: real mouse and keyboard at 1440×900 against the
  live instance, recording `document.getAnimations()` every frame; holding
  `/api/program` in the browser to prove an added line is on screen, pending
  and typeable before the server answers and rolls back when refused; then the
  same with `reducedMotion: "reduce"`, where nothing inside the coach shell may
  run longer than 1 ms.
- `npm run perf:coach-editor`: frame timing in the editor (below).

## Performance

`npm run perf:coach-editor` (scripts/perf-coach-editor.mts), on Joey's
MacBook, headless Chromium at 1440×900, against `next build --webpack` /
`next start`. The week is five days of six lines, every load cell with its
kilos line. "Before" is `origin/dev` at a12f235; "after" is this branch. Two
runs each, built and measured back to back in one session; the table shows
the range. Re-measured 16 Oct 2026 after the tint went from 900 to 400 ms and
the placeholder row went in.

| Scenario | Frames > 33 ms (before → after) | Long animation frames / long tasks | Main-thread time, ms (before → after) | Style recalc, ms (before → after) |
| --- | --- | --- | --- | --- |
| Typing 12 cells, 1× CPU | 0 → 0 | 0 / 0 → 0 / 0 | 176–204 → 211–214 | 2 → 12–13 |
| Switching views ×9, 1× | 0 → 0 | 0 / 0 → 0 / 0 | 114 → 134–146 | 7 → 14 |
| Typeahead ×3, 1× | 0 → 0 | 0 / 0 → 0 / 0 | 259–266 → 252–272 | 6–7 → 29–31 |
| Typing, 4× throttled | 0 → 0 | 0 / 0 → 0 / 0 | 396–413 → 557–558 | 3–4 → 23–25 |
| Switching views, 4× | 0 → 0 | 0 / 0 → 0 / 0 | 263–269 → 335–375 | 19–21 → 37–42 |
| Typeahead, 4× | 0 → 0 | 0 / 0 → 0 / 0 | 248–284 → 390–392 | 8–10 → 41–48 |

Frame p50 and p95 were 16.7 ms in every run; the worst frame after was
16.8 ms (one 33.3 ms frame appeared in the *before* build's 4× view switch,
under the 33.4 ms threshold).

- [Fact] No jank measured: not one frame over 33 ms, and no long animation
  frame or long task, in either build, at 1× or 4× throttling. The observers
  were checked to work in this browser: a deliberate 120 ms block is reported
  as a long task and a long animation frame.
- [Fact] The motion still costs main-thread time at 4×: typing +~150 ms
  (+35–40%) over the 3-second burst, view switching +~90 ms, typeahead
  +~125 ms, mostly style recalculation and paint.
- [Fact] With the 900 ms tint the typing delta was +~200 ms (+50–55%; before
  369–391, after 572–613 in the first session). At 400 ms it is +~150 ms.
  The typing cost came down, by about a quarter of the added cost, not to
  zero. Style recalc while typing at 4× went from 28–31 to 23–25 ms.
- [Inference] What remains is the transitions on every grid input and the
  shorter tints, plus, in this build, the placeholder row's extra render per
  add (not in the typing scenario, which adds no lines).
- [Unverified] Headless Chromium's frame clock is not a real display's and
  4× throttling of an Apple-silicon core is not a real slow laptop. These are
  comparisons between two builds on one machine. A real-device check on
  Ruairi's laptop (DevTools Performance panel, typing down a week) would
  confirm.
