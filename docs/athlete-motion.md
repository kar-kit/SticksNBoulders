# Athlete-side motion

_Design note, 21 Oct 2026. Feature F0: the motion base for the athlete's phone
screens. It builds the tokens, the press, and haptics, plus a demo panel on
`/design`. The features that will use it (keypad sheet, swipe-to-delete rows,
the set-logged tick, planned rows sliding in, the PR badge, screen
transitions) are not built here._

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

## Not verified

- [Unverified] Real-device feel: spring timing, the tap press and `:active`
  on an iPhone home-screen PWA and on Android Chrome. jsdom loads no
  stylesheet. Confirm with a session on Joey's phone and an Android device,
  `/design` first.
- [Unverified] Android vibration strength. The 8 ms `light` pulse may be
  imperceptible on some motors. Tune on a device.
