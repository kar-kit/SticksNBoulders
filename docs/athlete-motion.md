# Athlete-side motion

_Design note, 21 Oct 2026. Feature F0: the motion base for the athlete's phone
screens. It builds the tokens, the press, and haptics, plus a demo panel on
`/design`. The features that will use it (keypad sheet, swipe-to-delete rows,
the set-logged tick, planned rows sliding in, the PR badge, screen
transitions) are not built here. Screen transitions landed later as F7, below._

Targets: the installed PWA on iPhone (iOS / Safari 17.2+) and current Android
Chrome. The rules are the coach side's (`docs/coach-motion.md`): Tailwind
first, no animation library, transform and opacity only for anything that
moves, colour allowed as paint, reduced motion makes it all instant. The
difference is the feel. A coach at a desk wants answers in ≤ 180 ms. An
athlete's thumb on glass expects the give of a native control, so the athlete
side moves on springs.

## Scope: an athlete variant, not an unscoped one

The tokens were never the problem. `@theme static` already puts every
`--ease-*`, `--transition-duration-*` and keyframe on `:root`. What was
coach-only was the **gate** (`coach:`) and the **reduced-motion floor**.

Unscoping both was rejected. `Button`, `TextField` and `ExerciseTypeahead`
are shared, so a bare motion class on them would animate the sign-in screen
and the coach's grid too, and the coach and athlete want different motion
on the same Button (hover for one, a spring press for the other). The base
mirrors the coach's instead:

- `athlete-motion` class on the root of `components/shell/athlete-shell.tsx`.
- `@custom-variant athlete (&:where(.athlete-motion, .athlete-motion *))` in
  `app/globals.css`. Shared components put athlete motion behind `athlete:`.
- The reduced-motion floor covers `.athlete-motion` as well as `.coach-scale`.
- `components/ui/coach-gate.test.tsx` now also rejects a bare `tap` on shared
  components and checks that `athlete:tap` is on every Button variant.

A screen that is only ever rendered inside the athlete shell (anything under
`app/(athlete)/`, `components/logging/`) can use the utilities bare. Shared
components in `components/ui/` must use `athlete:`.

## Tokens (`app/globals.css`)

New beside the coach's. The coach's (`ease-out`, `ease-in`, `duration-press`,
`-quick`, `-base`, `-panel`, `animate-fade-in`, …) are available to the
athlete side too.

| Token | Value | Used for |
| --- | --- | --- |
| `ease-spring` | spring, response 0.35 s, damping 0.85; ~0.6% overshoot | general answers: the press letting go, a row arriving |
| `ease-sheet` | spring, response 0.42 s, damping 0.92; no visible overshoot | a bottom sheet coming up. A sheet that bounces past rest shows a gap under it |
| `ease-bounce` | spring, response 0.38 s, damping 0.6; ~9% overshoot | moments worth marking: a set logged, a PR |
| `duration-spring` | 488 ms | `ease-spring`'s settle time |
| `duration-sheet` | 439 ms | `ease-sheet`'s settle time |
| `duration-bounce` | 614 ms | `ease-bounce`'s settle time |

The durations are each spring's settle time to within 0.1%, so **a spring
curve and its own duration token are always used together**. Put a spring on
any other duration and you change its stiffness. They read shorter than they
are, because a spring covers most of its distance in the first third, and
nothing waits on them: input is live from the first frame.

**`linear()` with a fallback.** In `@theme static`, each `--ease-*` spring is
a cubic-bezier (`0.2,0.9,0.3,1` / `0.32,0.72,0,1` / `0.34,1.56,0.64,1`). An
unlayered `@supports (transition-timing-function: linear(0, 1))` block then
redefines all three on `:root` as the sampled spring. Safari 17.2 and Chrome
113 were the first releases with `linear()`, so every target gets the spring
[Fact: MDN compatibility data]. The fallback covers older browsers only.

The curves come from `lib/ui/spring.ts`: a damped harmonic oscillator,
sampled at 400 points over its settle time and simplified (Ramer-Douglas-
Peucker) to within 0.2% of the real curve, which takes 21-26 stops. Do not
hand-edit them. Change `SPRINGS` and run `npx tsx scripts/spring-easings.mts`,
then paste the output. `lib/ui/spring.test.ts` fails if globals.css and the
generator disagree, on a curve or on a duration.

## Keyframes and animations

| Utility | Keyframe | Curve, duration | For |
| --- | --- | --- | --- |
| `animate-sheet-in` | `translate: 0 100%` → rest | sheet, `sheet` | bottom sheet up (the keypad) |
| `animate-sheet-out` | rest → `translate: 0 100%` | `ease-in`, `panel` (240 ms) | bottom sheet down |
| `animate-fade-in` (coach's) | opacity 0 → | `ease-out`, `base` | the sheet's backdrop arriving |
| `animate-fade-out` | → opacity 0 | `ease-in`, `base` | the sheet's backdrop leaving |
| `animate-row-in` | opacity 0, 8 px below → | spring, `spring` | a planned set or a logged set joining a list |
| `animate-spring-pop` | opacity 0, scale 0.6 → | bounce, `bounce` | a badge or count arriving (PR badge) |
| `animate-tick-in` | opacity 0, scale 0.4, −20° → | bounce, `bounce` | the logged-set tick |

Things arrive on a spring and leave on `ease-in`. Something leaving should
get out of the way, not settle. Every keyframe is `translate`, `scale`,
`rotate` or `opacity`, the individual transform properties, so an
animation never clobbers a `transform` the element already has (the set
row's swipe offset, say).

Rules for the features that use these:

- **Gate transforms behind `motion-safe:`**, as on the coach side
  (`motion-safe:animate-sheet-in`). Under reduced motion the animation is then
  absent, `exitDuration` reads 0, and `afterExit` unmounts at once.
- **Exits use `usePresence` + `afterExit`** from `components/ui/motion.ts`.
  Close semantically at once (focus back, `inert`) and let only the paint
  linger. `app/design/motion-panel.tsx` shows the pattern for a sheet.
- **Arrivals use `useArrivals`**, so rows that were there when the screen
  opened do not slide in on every load. Only an added row does.
- **Replays use a `key`** (or `useChanged`), so a second tick or PR remounts
  and plays again.
- **No layout animation.** Nothing animates height, width, top or margin. A
  row that arrives takes its space in one step, then slides in.

## The keypad sheet (F1)

`components/logging/log-sheet.tsx`. The Log screen's number pad and RPE
chips live in one bottom sheet, `sticky bottom-0` as the last child of the
screen, inside `<main>`. Sticky rather than fixed: the sheet keeps its height
in flow, so the last rows can always scroll above it without measured
padding, and it sits above the tab bar (which owns the home-indicator inset)
without knowing the tab bar's height. It opens on `animate-sheet-in`, closes
on `animate-sheet-out` through `usePresence` + `afterExit`, and swapping pad
for RPE swaps content without re-animating. No backdrop: the rows stay live.
When it opens, or the field changes, `revealAboveSheet` scrolls `<main>` so
the tapped row sits 12 px above the sheet (smooth, `auto` under reduced
motion). Pad keys carry `tap` and `haptic("light")`. The `bottom` arbiter in
log-screen.tsx is unchanged: the sheet only holds what wins "pad" or "rpe".

## The press (`tap`)

`@utility tap`: on `:active` the element scales to 0.97 over `press` (90 ms,
`ease-out`). On release it springs back over `duration-spring` on
`ease-spring`, so letting go has a native control's small give instead of a
snap. It carries its own transition (colour, background, border, opacity,
scale) so a variant's `active:` fill fades back with the scale. It sets
`-webkit-tap-highlight-color: transparent`, because iOS's grey tap flash would
otherwise sit on top of the fill change. The scale is `prefers-reduced-motion:
no-preference` only, while the colour still answers under reduced motion.

`Button` (`components/ui/button.tsx`) carries `athlete:tap` on every variant,
so every athlete-shell button presses this way now. The coach's
`coach:transition-control coach:press` is unchanged.

[Inference] iOS Safari only applies `:active` on touch when a touch listener
exists on the element or an ancestor. React 17+ attaches its event listeners,
`touchstart` included, to the root container, which should satisfy that. The
Button's existing `active:bg-accent-pressed` relied on the same thing.
[Unverified] on a real iPhone in standalone mode. A device check confirms it.

## Haptics (`lib/ui/haptics.ts`)

`haptic(kind)` returns `true` if the platform accepted the pattern and `false`
otherwise. It never throws.

| Kind | Pattern (ms on/off) | For |
| --- | --- | --- |
| `light` | 8 | a tap answering: stepper tick, toggle |
| `medium` | 16 | a sheet snapping open, a row arming for delete |
| `success` | 12, 60, 18 | a set logged |
| `warning` | 30, 80, 30 | a refusal, a destructive confirm |
| `alert` | 200, 100, 200 | the end of a rest, felt through a pocket |

- **Android Chrome** vibrates through `navigator.vibrate`. Chrome refuses
  until the page has had a user activation (any earlier tap counts). That
  refusal returns `false`, the same as a no-op.
- **iOS** has no `navigator.vibrate`, in a Safari tab or an installed PWA.
  Every call returns `false` and nothing happens. **Nothing may depend on a
  buzz arriving**: the visual answer carries every moment on its own.
- **Not gated on reduced motion.** A vibration moves nothing on screen, and
  reduced motion concerns on-screen movement. [Inference] iOS keeps system
  haptics on under Reduce Motion for the same reason (they have their own
  toggle). If haptics ever need an off switch, it belongs in Profile &
  Settings, not on the motion query.
- **The rest timer** goes through it. `buzzRestOver` in
  `lib/logging/rest-timer.ts` is now `haptic("alert")`, and `REST_BUZZ` is
  `HAPTICS.alert`, the same `[200, 100, 200]` it always was.

**Considered and deferred: the iOS 18 switch trick.** Since iOS 18, Safari
plays a system haptic when an `<input type="checkbox" switch>` toggles, and a
hidden switch clicked through its `<label>` inside a user gesture can fake a
tap haptic on iPhone. It is not built. It depends on undocumented behaviour
that Apple can remove in any point release. It only fires inside a user
gesture, so the rest-timer alert can never use it. It also needs real-device
testing across iOS versions before anyone should trust it. Revisit after
device testing, behind `haptic()` so callers do not change.

## Reduced motion

The coach side has two layers and the athlete side now has the same two.
First, every transform is behind `motion-safe:` (or, in `tap`, a
`no-preference` query). Second, the floor in `globals.css` covers
`.athlete-motion`: every animation and transition inside the athlete shell
runs 0.01 ms (not 0, so `animationend` still fires for `afterExit`). This
also makes the hand-set upload bar instant under reduced motion. The set-row
swipe (F2) is on the tokens now: snap-back on `ease-spring` / `duration-spring`,
the exit on `ease-in` / `base` with `animate-fade-out`, both behind
`motion-safe:`, so under reduced motion the row snaps and the delete is
immediate. The row still follows the finger: that is direct manipulation,
not animation.

## Demo

`/design`, panel "Motion — athlete" (`app/design/motion-panel.tsx`). It holds
the buttons under `tap`, a phone-sized frame with a bottom sheet (in/out, with
backdrop, unmounted through `usePresence` + `afterExit`), Add row
(`row-in`), Log set (`tick-in` + `haptic("success")`), PR (`spring-pop`),
and one button per haptic kind.

## Tests

- `lib/ui/haptics.test.ts`: each kind's pattern, a copy handed over, no-op
  without navigator, vibrate, on refusal and on throw, the real navigator by
  default, and not silenced by reduced motion.
- `lib/ui/spring.test.ts`: the oscillator, the `linear()` output staying
  within tolerance of the real curve, and globals.css matching the
  generator (curve, fallback, duration).
- `components/ui/coach-gate.test.tsx`: no bare `tap` on shared components;
  `athlete:tap` on every Button variant.
- `components/shell/shell.test.tsx`: the athlete shell carries
  `athlete-motion`.
- `app/design/motion-panel.test.tsx`: the sheet opens and unmounts on close,
  only added rows slide in, and the tick buzzes `success`.
- `lib/logging/rest-timer.test.ts`, `app/(athlete)/log/log-screen.test.tsx`:
  unchanged, still passing through `haptic`.

## Screen transitions (F7)

_Added 21 Oct 2026._ Route changes inside the athlete shell animate the way a
UIKit navigation stack does. A drill-in slides the new screen in from the
right while the old one drifts a third of the way left and dims. Going back
reverses it. A tab switch is a quick crossfade with no sliding between peers.
The tab bar and the shell's chrome never move.

### Approach: React `<ViewTransition>`, no config flag

Next 16.3's bundled docs (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`)
say view transitions "work in the App Router with no configuration". The
App Router runs the React canary bundled in `next/dist/compiled/react`, which
exports `ViewTransition` and `addTransitionType`, and every navigation is a
React transition [Fact: read from the compiled source]. There is no
`experimental.viewTransition` key in this Next's config schema any more, so
**`next.config.ts` is unchanged**.

The alternative, `document.startViewTransition` wrapped around
`router.push`, was rejected. Next commits the new route inside its own
transition, so a hand-rolled wrapper would capture the "new" state before
React had committed it. It would also miss `<Link>` and popstate navigations
unless every call site were wrapped. React's integration starts the view
transition at commit, captures the right DOM, and does the right thing when
the API is missing.

How it is wired:

- `components/shell/screen-transition.tsx` wraps the shell's `<main>` (the one
  scroll container) in `<ViewTransition name="athlete-screen" default="none"
  update={class}>`. It is one wrapper in the shell, not one per page:
  Next's own guide puts directional wrappers in each `page.tsx` and keys them
  off `transitionTypes` on each `<Link>`. Wrapping the persistent `<main>`
  and using `update` lets the snapshot be `<main>`'s box, so a long scrolled
  screen is clipped to the scroll container and never spills over the
  status-bar strip or the tab bar mid-slide.
- For link and `router.push` navigations, the class is worked out during
  render, from the pathname being committed and the one last committed (a
  small external store read with `useSyncExternalStore`, updated in a
  layout effect). React reads `update` from the props of the commit
  that starts the view transition. After that commit the store catches up and
  the class drops back to `none`, so a later transition inside a screen (a
  Suspense reveal, a `useTransition`) does not replay the slide.
- The tab bar carries `view-transition-name: athlete-tabbar`
  (`components/ui/tab-bar.tsx`). Its group is not animated, its old snapshot
  is hidden, and it sits above the sliding screen, so the lit tab switches at
  once and the screen passes under it. The safe-area strip and "Coach mode"
  stay in the root snapshot, whose crossfade is turned off.
- The CSS is in `app/globals.css` ("Athlete screen transitions") and acts on the
  `vt-push`, `vt-pop` and `vt-tab` view-transition classes.

### The direction model: route depth

`lib/ui/screen-transition.ts`, `classifyNavigation(from, to)`:

| Move | Motion |
| --- | --- |
| Same path (query or hash only) | none |
| Into another tab's stack (`/history/s1` → `/today`, `/today` → `/log`) | crossfade |
| Deeper (`/history` → `/history/s1` → `/lift/squat`, `/me` → `/bodyweight`) | push |
| Shallower | pop |
| Sideways at one depth (`/lift/a` → `/lift/b`) | crossfade |

A tab root is depth 0 and each segment below it adds one. Screens outside the
four tabs (`/lift/[id]`, `/bodyweight`) count their own first segment as well,
because they are always reached from inside a tab: `/bodyweight` is 1 and
`/lift/x` is 2, so opening a lift from a session still pushes.

Depth was chosen over `transitionTypes` on each `<Link>`. It needs no change at
any call site (including `log-screen.tsx` and the logging components, which
this feature does not touch). It covers `router.back()`, used by Lift Detail
and Coach Feedback, and the browser's back/forward, neither of which carries a
transition type. And nobody can forget it on the next screen. The cost:
tapping a tab from Lift Detail or Bodyweight reads as a pop, because those
screens belong to no tab's stack. [Inference] That reads as "going back up",
and it was judged acceptable.

### Back and forward: animated here, not by React

**React does not animate back/forward.** A transition started inside a
`popstate` event is rendered synchronously, so the browser can restore
scroll (`shouldAttemptEagerTransition` in react-dom), and a synchronous commit
never starts a view transition [Fact: read from the compiled react-dom; seen
in headless Chromium, where `goBack()` produced no `startViewTransition`
call]. Next's guide says only that browser back "does not carry a transition
type"; in practice nothing animates at all. That covers `router.back()`
(Lift Detail and Coach Feedback use it), the browser buttons, and Android's
back gesture.

So `animateTraversals` in `lib/ui/screen-transition.ts` handles them. It runs
as a capture-phase `popstate` listener on `window`, which fires before the
Next router's bubble-phase one. When a traversal should animate, it:

1. stops the event from reaching the router,
2. names `<main>` `athlete-screen` and gives it the depth model's class
   (`view-transition-name` / `view-transition-class` inline),
3. calls `document.startViewTransition`, and inside the update callback
   dispatches a marked copy of the event (same `state`), which the router
   handles as normal,
4. resolves the callback once the shell's layout effect reports the new
   pathname committed, capped at 500 ms. Measured in Chromium dev mode:
   20-120 ms of held frame.
5. removes the inline name and class once the transition finishes.

The update callback runs even when the browser skips the animation, so the
router always gets its popstate. If `startViewTransition` throws, the copy
is dispatched at once.

It lets the event straight through, unanimated, when:

- the browser has no `startViewTransition`;
- the traversal lands on the screen already showing (a dialog closing
  through history, a hash change);
- the browser drew its own transition. Where
  `PopStateEvent.hasUAVisualTransition` exists it is trusted: Chrome on Android
  reports `true` for its back-gesture animation, and so does Safari for an
  edge swipe where it implements the property. Where it does not exist, an
  **iOS Safari tab** is assumed to have swiped, since that is the usual way
  back there. A tapped back button then switches instantly, which costs less
  than a slide on top of a swipe. An **installed iOS PWA** has no system
  swipe-back, so ours plays.

[Inference] Re-dispatching the popstate depends on the Next router reading
only `event.state` and `location` (16.3.4's `onPopState` does exactly that).
A Next upgrade that changes the router's popstate handling should re-run the
back check in the PR.

### Motion and tokens

| Class | Old screen | New screen | Curve, duration |
| --- | --- | --- | --- |
| `vt-push` | `translate` 0 → −30%, opacity → 0.6 | `translate` 100% → 0, on top, edge shadow | `ease-sheet`, `duration-sheet` (439 ms) |
| `vt-pop` | `translate` 0 → 100%, on top, edge shadow | `translate` −30% → 0, opacity 0.6 → 1 | `ease-sheet`, `duration-sheet` |
| `vt-tab` | UA fade out | UA fade in (plus-lighter) | `ease-out`, `duration-base` (180 ms) |

The push uses the sheet spring for the sheet's reason: a screen that overshot
its rest would show a sliver of the one under it. While the two screens
overlap they are opaque (`background: var(--color-background)`,
`mix-blend-mode: normal`), because `<main>` has no background of its own and
one screen's text would otherwise show through the other. Only `translate`
and `opacity` animate. `::view-transition { pointer-events: none }` lets a
tap during the slide reach the live page.

### Reduced motion, unsupported browsers

- **Reduced motion**: push and pop become the tab crossfade (opacity only,
  `duration-base`). That is what iOS does with Reduce Motion on. The
  `.athlete-motion` floor does not reach the view-transition pseudo-elements,
  which live outside the shell, so the media query in the F7 block handles
  them.
- **No `document.startViewTransition`** (iOS 17.x, Safari < 18, old
  Chrome): React's call throws, React catches it and commits synchronously,
  and the screen switches at once. Nothing is named outside a transition,
  so there is no leftover state.
- **Partial support**: React passes `types` in the options-object form of
  `startViewTransition`. [Unverified] on Safari 18.0/18.1, which may predate
  that form. If it throws there, React's same catch gives an instant switch,
  not a broken one. A device check confirms which one happens.

### Tests

- `lib/ui/screen-transition.test.ts`: depth and tab ownership, every row of
  the direction table, push/pop symmetry, `hasUAVisualTransition` trusted
  and the iOS fallback heuristic, environment detection, feature detection.
  `animateTraversals` covers: back pops, with the router getting exactly one
  (replayed) popstate while `<main>` is named; forward pushes;
  browser-animated traversals left alone; same-screen popstate and
  pre-first-commit ignored; no API falls through; a throwing
  `startViewTransition` still reaches the router; the 500 ms cap;
  unsubscribe.
- `components/shell/screen-transition.test.tsx`: renders on **Next's bundled
  React canary** (the real `<ViewTransition>`) with a recording
  `startViewTransition`. Covers an instant switch with no API, `vt-push` then
  `vt-pop` with `<main>` named `athlete-screen`, `vt-tab` between tabs, and
  no replay on a later in-screen transition.
- Headless Chromium at 390x852 against the local mock harness: push, pop
  by link, browser back (pop) and forward (push), tab crossfade, reduced
  motion (opacity only, 180 ms), and with `startViewTransition` deleted
  (instant, no errors). Recorded in the PR.

## Not verified

- [Unverified] Real-device feel: spring timing, the tap press and `:active`
  on an iPhone home-screen PWA and on Android Chrome. jsdom loads no
  stylesheet. Confirm with a session on Joey's phone and an Android device,
  `/design` first.
- [Unverified] Android vibration strength. The 8 ms `light` pulse may be
  imperceptible on some motors. Tune on a device.
- [Unverified] Screen transitions on a real iPhone (installed PWA and Safari
  tab, including edge-swipe back and whether Safari reports
  `hasUAVisualTransition`) and on Android Chrome with predictive back.
  Headless Chromium only, see the PR.

## Prescribed rows, swap and the rest in the sheet (F5)

- **Rows laid out at once.** Opening a prescribed exercise lays out every set
  still to do (blank warm-ups ahead of each line's first working set, then
  the working sets priced to the coach's lines). `ExerciseBlock` runs
  `useArrivals` over its planned row ids and `SetRow` takes `arrived`, so
  those rows (and any Add set row) come in on `motion-safe:animate-row-in`.
  Logged sets read back after a reload never animate.
- **Video ask.** A flagged row wears a small camera badge (top-right, over
  the border, moves with a swipe). No motion, no gate.
- **Swap variant** opens `VariantSheet` in the LogSheet. It takes its turn in
  the `bottom` arbiter after pad and RPE, before the finish confirm. The pick
  buzzes `light`.
- **The rest bar** now rides in the LogSheet too (`RestBar inSheet`) when it
  wins `bottom`, so it is in view after logging on a long prescribed day.
  Swapping between pad, RPE, swap and rest swaps content without
  re-animating; the sheet only animates when it opens or closes.

## Previous, PR badges and the way to a lift's history (F6)

_Added 22 Oct 2026._ Athlete feedback: "No way to see what sets I have done
before, like the Strong app, and PRs."

- **Previous.** Every row, logged or not, carries a `PREV 140 × 5` line under
  it: the set it lines up with from the last session that trained that exact
  exercise. Warm-ups line up with warm-ups, working sets with working sets,
  and a swapped block's rows each read their own variant's last time
  (`lib/logging/previous.ts`). A line, not a sixth grid column: at 390pt the
  `GRID` has ~110px for the load cell, and a Previous column would leave it
  under 40px. On a row not logged yet the line is a button (`tap`,
  `haptic("light")`) that copies load and reps into the row as if typed. No
  motion of its own; it arrives with the row or, when the read lands later,
  in one step.
- **Prefill rule 4.** A free exercise's blank, untouched working rows take
  last time's numbers (`fillFromLastSession`, through `resolvePrefill`), also
  when the read lands after the row appeared. Prescribed rows and warm-ups
  are never filled.
- **PR badge.** A logged set that beats the athlete's best e1RM or heaviest
  working weight before this session wears a `PR` pill on the row's top
  border, beside the video badge's corner. A set confirmed on this page pops
  it in on `motion-safe:animate-spring-pop` and buzzes `haptic("success")`
  once; a badge read back after a reload sits still and is silent. The rules
  (bests frozen at the session's start, a running best through the session,
  warm-ups never, a tenth-of-a-kilo comparison) are in `lib/strength/pr.ts`.
  The finish screen lists the day's records, one per exercise per kind.
- **Rep PR (F8, 22 Oct 2026).** Product ask: "a weight PR and then a rep
  PR at different weights." A logged working set with more reps than the
  athlete ever did at that load or heavier wears the same pill, reading
  `Rep PR` when that is its only record and `PR` when it also broke the
  e1RM or the weight; same spring-pop, same single `haptic("success")`. The
  finish screen lists rep records one per load, folding one into a later
  record today that covers it (140 × 6 then 140 × 7 is one line), heaviest
  first, after the exercise's e1RM and weight lines. Lift Detail does not
  show them: its records come from the rollups, which cannot answer it.
- **History link.** A clock icon beside the block's name opens
  `/lift/[id]` for the exercise in hand (the swapped variant when swapped).
  `/log` is depth 0 and `/lift/x` depth 2, so F7 slides it in as a push with
  nothing set at the call site. The name itself still reopens the block.

## The edit sheet over a dimmed page (F16)

_25 Oct 2026. Source: Joey._ The plain logging keypad keeps **no backdrop**
(F1, above): the rows stay live because tapping the next field is how an
athlete moves on. "Edit set N" (F9) now does the opposite. It rewrites a set
already done, so it is modal over a scrim, and a stray tap cannot abandon a
draft without asking.

- **`components/logging/modal-sheet.tsx`**, a native `<dialog>` opened with
  `showModal()`, the same choice and mechanics as the coach's `Dialog`
  (`components/ui/dialog.tsx`). The browser makes the page behind inert and
  removes it from the accessibility tree, keeps focus in the sheet, puts the
  sheet in the top layer above the tab bar, and turns Escape and Android's
  back gesture into `cancel`. Focus goes back to the opener on close.
  `LogSheet` is untouched. The `bottom` arbiter still picks "edit", but the
  Log now hands that sheet to `ModalSheet` and gives `LogSheet` nothing.
- **Dismissing.** A tap on the scrim or Escape is a request (`onDismiss`).
  An untouched draft closes. A changed one opens "Discard changes?" in the
  `Dialog` at `size="sm"`, `feel="athlete"` (F18's phone question), with
  Keep editing or Discard. It is rendered as a sibling of the sheet so its
  Escape cannot reach the sheet's. A changed draft is the inverse of Save's
  no-op: `editOf(draft) === null || changesSet(set, edit)`. Cancel and Save
  in the sheet do not ask, because they already say what they do.
- **Motion.** The scrim (`bg-black/70`, Dialog's dim) is a child of the
  full-screen, transparent dialog, not `::backdrop`, so it can fade out while
  leaving. It fades in on `animate-fade-in` and out on `animate-fade-out`. The
  panel rises on `motion-safe:animate-sheet-in` and leaves on
  `motion-safe:animate-sheet-out`. Opacity and translate only. Leaving
  closes the modal at once (page live, focus back), then sets the `open`
  attribute so the dialog stays painted, non-modal and inert, until
  `afterExit` on the panel. The attribute is used rather than `show()`,
  which would pull focus back in. Under reduced motion it all unmounts at
  once.
- **Geometry.** The panel now covers the tab bar, so it carries `pb-safe`
  for the home indicator. It scrolls (`overflow-y-auto`, capped below the top
  inset) when pad, note, video and Delete outgrow a small phone. The row being
  edited is still scrolled clear of the panel by `revealAboveSheet`.

[Unverified] on a real device: iOS standalone PWA. Three things to check: the
scrim stops touches reaching `<main>`, the keyboard for the note field does
not hide the panel, and during the 240 ms exit the tab bar may paint over the
fading scrim. The dialog is no longer in the top layer by then, and the tab
bar has its own `view-transition-name`. That last one is cosmetic.

## The video ask popup (F18)

_Added 25 Oct 2026._ `Dialog` takes `feel="athlete"`: it arrives on
`ease-spring` / `duration-spring` (scale 0.98 and 4 px below to rest, behind
`motion-safe:`, the fade always), its backdrop fades in on `ease-out` /
`base`, and it leaves on `ease-in` / `base` like the coach's. It is still
inside `.athlete-motion` in the DOM even in the top layer, so the reduced-motion
floor (which covers `::backdrop`) makes it instant. Exit goes through
`usePresence` + `afterExit`. See docs/video.md, "The coach's ask as a popup".


## Marking a set failed (F19)

_25 Oct 2026. Source: Joey. Schema v19 (`sets.failed`)._ An athlete who misses
a set logs the reps they actually completed -- 0 for a missed single -- and
flips **Failed**. A failed set counts toward set count, volume and tonnage with
those reps, and toward nothing else: no e1RM, no PR of any kind, never a best
in the rollups or the rep frontier (docs/e1rm.md, docs/rollups.md,
lib/strength/pr.ts).

- **Where the switch is.** `components/logging/failed-switch.tsx`, one
  component in two places of the keypad sheet: the number pad's bottom row,
  beside Warm-up, and under the RPE chips ("next to RPE", the question being
  answered there). The edit sheet (F9/F16) passes it to both too, and History's
  in-place editor to its pad and chips. Never on the row itself: a stray thumb
  on the most-tapped surface could fail a set nobody missed.
- **Semantics.** `role="switch"` + `aria-checked`, named "Failed" by
  `aria-label`; under the chips it carries a description, "Reps are the ones
  you completed", by `aria-describedby`, so the name stays one word. Toggling
  records nothing and never closes the RPE chips (a chip does): the confirm
  square or Save writes the set, as for every other field. The confirm square
  accepts 0 reps only on a failed row (`canComplete`).
- **Motion.** `tap` press and `haptic("light")`, like Warm-up. On is
  `bg-danger-fill` (paint only, so it answers under reduced motion too): the
  accent means good news here (the confirm, a PR) and a miss is not one.
- **The marker.** `components/ui/failed-mark.tsx`, a static outlined pill in
  `danger-line`, the word "Failed", never colour alone. On a set row it sits on
  the top border at the left (`-top-2 left-2`), opposite the PR and video
  corner, takes no column and no height, and moves with a swipe. It shows on a
  row not logged yet as well, so the switch is visibly on the right set. No
  animation, so no `athlete:` gate is needed on the shared side. The same mark
  sits beside the numbers in History, Lift Detail's recent sets, the coach's
  session list, Athlete View's lift panel and the Review Queue's clip panel
  (main set and recent sets); the coach's clip list and the program editor's
  context drawer say "failed" in words.
- **Previous (F6).** A set missed last time stays in line, marked: `PREV 200 ×
  0 · failed`. Hiding it would slide every later set of last time onto the
  wrong row. Copying it (the PREV tap) and prefill rule 4 take its load and
  not its reps.
- **Next rows.** A failed set reprices nothing behind it (`refreshBehind`
  treats it like a warm-up) and anchors no suggestion; Add set after it repeats
  the load with the reps blank.
- **Offline.** The flag rides in `set.create` / `set.update` ops like the other
  values; `queuedSets` and `queuedSetEdits` read it back after a reload, and an
  op queued by a pre-v19 client reads as made. Every correction restates it, so
  the set number's warm-up flip or a note edit from the Clips gallery cannot
  un-fail a set.

## Logging 0 kg on a bodyweight exercise (F20)

_28 Oct 2026. Source: Joey, mid-session on pull-ups. Schema v20
(`exercises.is_bodyweight`)._ A set of an exercise flagged bodyweight can be
logged at 0 kg; any other lift still refuses 0 kg, because a 0 typed on a squat
is a thumb that missed the 1. Added load logs as it always did (+20 kg is 20).
The rule and its maths live in `lib/exercises/bodyweight.ts`; what a 0 kg set
counts toward is in docs/e1rm.md, docs/rollups.md and `lib/strength/pr.ts` (a
set and its reps, 0 tonnage, a rep record, never a weight or e1RM record).

- **Where the flag comes from.** The library: `BODYWEIGHT_EXERCISES` in
  `lib/exercises/seed.ts` for the shared rows (the seed script reconciles it),
  and a "Bodyweight exercise" checkbox in Me → My exercises for the athlete's
  own. The screen lends it to the rows (`ExerciseBlock isBodyweight`, History's
  editor), never stores it on a set. A library cached before v20 has no flag,
  which refuses 0 kg rather than allowing it.
- **The refusal says why.** `completionBlocker` returns `"zero-load"` for 0 kg
  off a bodyweight lift. A row reading `0 × 12` looks finished, so a dead
  confirm square beside it needs a reason: the active row shows "0 kg logs only
  on a bodyweight exercise" on its info line (in place of a suggestion's note)
  and as the confirm's `aria-describedby`. The edit sheet puts the same line
  under its values and on Save. No motion: it is text that appears with the
  number.
- **Next rows.** Add set and the untouched rows behind a 0 kg set repeat 0 kg
  (prefill rule 3), and Previous shows `PREV 0 × 12`, copyable like any other.

## The finish screen's records (F22)

_28 Oct 2026. Source: Joey, after a session: "Make the PRs at the end of a log
more animated and important, maybe a different colour."_

- **Hierarchy.** With at least one record, `FinishedSummary`
  (`components/logging/finished-summary.tsx`, moved out of `log-screen.tsx`)
  puts `PrCelebration` (`components/logging/pr-celebration.tsx`) between the
  "Session done" heading and the totals. The first record is the headline:
  exercise name at `heading`, figure at `hero` (46px) in the record colour,
  the kind and the set under it. The rest are rows with `value-lg` (24px)
  figures. The totals stay, but step back (`value-sm` figures, a tighter
  tile). **With no records the screen is the old one class for class**: no
  empty hero, totals at `display`, no motion, no buzz.
- **Colour.** A new `--pr` token, `#e8b84a`, with `--on-pr` (`#1d1c22`) for a
  label on it, mapped as `pr` / `on-pr` in `@theme inline`. A gold, kept apart
  from the copper (`--accent-fill`), which already means "do this" and is the
  in-log PR pill; that pill is unchanged. It clears AA outright as text (9.17:1
  on `--background`, 8.23 on `--surface`, 7.24 on `--surface-2`) and as a fill
  (9.17 behind `--on-pr`), so it needs no fill/line split. The card is
  `bg-pr/10` over the page: on that tint `--pr` is 7.50, `--foreground`
  12.25, `--muted` 5.59, `--muted-2` 4.70 (4.49 at 12%, so do not thicken it).
  `lib/design/tokens.test.ts` checks all of these against the real stylesheet.
- **Accessibility.** The section keeps its label, "Personal records". Its
  first child that is read is the count ("New PR" / "3 new PRs"), so that is
  the first thing a screen reader meets in it. Every figure is final text from
  the first render: there is no count-up to be read half-way.

### Motion

| Piece | Utility | Curve, duration |
| --- | --- | --- |
| Count pill | `motion-safe:animate-spring-pop` | bounce, `bounce` |
| Each card | `motion-safe:pr-card-in`: `row-in`, delayed `--pr-index` × 70ms, index capped at 5 | spring, `spring` |
| Headline figure | `motion-safe:animate-spring-pop` (`origin-left`) | bounce, `bounce` |
| Sweep | `motion-safe:animate-pr-sweep` on an `aria-hidden` `pr-sweep-band` layer | `ease-in-out`, 900ms, after `panel` (240ms) |
| Haptic | `haptic("success")`, once per mount, only with a record | |

- **Transform and opacity only.** `pr-sweep` is `translate` and `opacity`;
  `pr-card-in` is `row-in`. The band itself is static paint.
- **Highlight, not count-up.** The brief allowed either. A count-up is JS
  timing that the CSS reduced-motion floor cannot reach, changes the figure's
  width as it runs, and a screen reader could read it mid-count. The pop plus
  the sweep crossing the figure is all CSS and lands in its end state at once
  under reduced motion.
- **`pr-card-in` is one utility, not `animate-row-in` plus a delay class**:
  the `animation` shorthand resets the delay, and which class wins would hang
  on Tailwind's output order.
- **Plays once.** Every animated element mounts with the screen and keeps its
  key, so a re-render (the queue, the library resolving a name) replays
  nothing. The buzz is guarded by a ref, the Log's `judged` idiom, so neither a
  re-render nor React's development double-run of effects buzzes twice. The
  Finish tap is the user activation Android Chrome needs; iPhone stays silent.
- **Back to Today is never held.** It carries no animation and is live from
  the first frame.
- **Reduced motion.** Everything is behind `motion-safe:`, so the classes are
  absent. The floor (`.athlete-motion *`, `animation-delay: 0s !important`)
  covers anything that slipped. The sweep ends at `opacity: 0` and rests at
  `opacity-0`, so it never shows.

### Demo and tests

- `/design`, panel "Finish screen — PRs" (`app/design/finish-panel.tsx`): the
  real `FinishedSummary` in a 390 × 852 `athlete-motion` frame, with No PRs,
  1 PR and 4 PRs, and Replay (a remount). The Colour panel gains `pr` as ink
  and as a fill.
- `components/logging/finished-summary.test.tsx`: 0, 1 and many records;
  order, count heading first; stagger indices and cap; every animation behind
  `motion-safe:`; figures final on first render; Back to Today outside any
  animation; nodes kept through a re-render; one `success` buzz under
  `StrictMode` and across a re-render; `pr-sweep` and `row-in` keyframes
  transform/opacity only; the floor's delay reset.
- `lib/design/tokens.test.ts`: the ratios above. `app/design/finish-panel.test.tsx`.
- `app/(athlete)/log/log-screen.test.tsx`: the existing finish-screen record
  tests pass unchanged.

[Unverified] On a device: the sweep's strength on an OLED iPhone at full
brightness, and whether the `success` buzz at finish reads as distinct from
the in-log PR buzz. Both are tuning, `/design` first.

## Logging cardio (F23)

_28 Oct 2026. Source: Joey, after a session. Schema v21 (`exercises.kind`,
`sets.duration_seconds`, `sets.level`)._ A cardio exercise -- the six seeded
machines (`CARDIO_EXERCISES` in `lib/exercises/seed.ts`: Treadmill, Treadmill
Running, Incline Walk, Stairmaster, Bike, Rowing Machine) or one the athlete
makes -- is logged as a time and an optional level. No distance, heart rate or
calories in this version; the machine is the exercise's name, never a field.
What a cardio set counts toward is in `lib/logging/cardio.ts`: nothing in the
strength maths, ever.

- **The row.** The set row's grid, unchanged: the time sits where the weight
  was, the level where the reps were, the RPE column is empty and the confirm
  is in its usual place, so a thumb that knows the row knows this one. The
  header reads `MIN · LEVEL`. Confirm needs a time above zero; level is
  optional (a flat walk has none). No warm-up number, Failed switch, RPE
  sheet, PR badge, camera badge, video nudge, camera or Lift Detail link on a
  cardio block. Logged rows go by the set's own `duration_seconds`, so a lift
  logged before the exercise was made cardio still draws as a lift.
- **The pad.** Time is typed in minutes: `20` is twenty minutes, which is
  nearly every cardio entry, two taps. The decimal key reads `:` while the time
  is open, so 20:30 is `2 0 : 3 0` with no keyboard; seconds cannot pass 59
  (`20:7` refuses the 7 rather than becoming 21:10). − and + step a minute.
  Level takes two digits and a decimal (treadmills step in halves). The pad's
  bottom row is Done and Level on the time, Done alone on the level: neither
  switch means anything for cardio.
- **Next rows.** Add set repeats the time and level (three rounds of five
  minutes is one tap each), Previous shows `PREV 20 min · level 8` and copies
  it, and a fresh row with nothing better takes last time's (prefill rule 4).
  No suggestion ever prices a cardio row.
- **Correcting one.** The edit sheet shows two values, time and level, on the
  same pad, with the note and Delete as on a lift and no video. History's
  editor does the same in place.
- **Adding one.** The typeahead tags cardio exercises (`cardio` beside
  `yours`) and offers "Add as cardio" under "Add custom exercise", so a ski
  erg is one tap from a time. My exercises has a Cardio exercise checkbox
  beside Bodyweight (which steps aside while Cardio is ticked) and a New
  cardio exercise field.
- **Totals.** The finish screen keeps its four strength stats and adds one
  small line under them, `Cardio · 20 min`; the PR block is untouched. History's
  header and cards add `20 min cardio` after the strength figures, and a
  session of only cardio reads as its time rather than "0 sets". The week
  summary card on the Log landing is unchanged: it reads rollups, cardio has
  none, and adding cardio minutes there would mean reading raw sets.
