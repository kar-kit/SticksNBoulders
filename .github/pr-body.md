## feat(log): ticking a set means done, plus a dedicated End session button

Joey, on the logger: *"There's no way to end a session at the moment that's
obvious, and there's no way to add a set or mark a set as completed without
adding a new set below it. It should be 'mark as completed' and that's it, no
adding new sets. There should also be a dedicated End session button."*

### What changes

- **Confirming a set only logs it.** `afterConfirm` (lib/logging/plan.ts) no
  longer appends a prefilled row when the exercise has nothing else waiting.
  It returns `next: PlannedRow | null`; a row the athlete already planned with
  Add set still becomes the head, exactly as before. The pad and RPE sheet
  close, focus clears (or moves to the next planned row), and the rest timer
  starts as it always has.
- **`+ Add set` is the one way to the next row.** It carries everything the
  auto-row used to: prefill from the last planned row or last logged set, the
  coach's prescribed target via `prescribeNewRows`, and the Order 28
  next-set suggestion. The suggestion is now computed in `addSet`
  (`suggestionFor` in log-screen.tsx) from the last logged set and passed to
  `addRow`, which only applies it when the exercise has no planned rows --
  behind a planned row it would be pricing the wrong set, and it never
  touches numbers the athlete typed. The coach's **held** switch still means
  no suggestion; that gate is unchanged (`nextSetSuggestion`).
- **End session button.** Full-width, outlined (`secondary`, `lg`, 48px)
  under the last exercise block, label and accessible name "End session".
  Opens the existing *Finish this session? N sets logged* panel and is hidden
  while that panel shows. It closes the pad / RPE sheet first, because both
  outrank the confirm panel for the bottom of the screen. The header clock is
  untouched and still opens the same panel (aria-label "Finish session").
- **Write-failure path:** if `logSet` throws (device storage unwritable), the
  row now goes back to the head of its exercise with the athlete's numbers.
  Before, the auto-row happened to carry them; without it they would vanish.

### Deliberately not done

- **No prescribed rows laid out up front.** A prescribed 3 × 5 still shows one
  row; each further set comes from Add set, priced to the coach's line.
- `activate` (tapping an exercise name) is unchanged: it opens one fresh,
  unplanned row from the last logged set, with no suggestion -- as before.
- The header clock does not close the pad when tapped (unchanged). Tapped
  mid-entry, the confirm panel waits behind the pad until it is dismissed, as
  it always has; the new button does not have this problem.
- Nothing in `lib/offline` touched.

### Tests

`npm test` 2232 passed / 138 files (baseline 2225 / 138). `npm run lint` and
`npm run typecheck` clean. New/changed coverage: confirm adds no row and
closes the pad; Add set after a confirm is the head and logs with the next
`set_index`; prescribed Add set carries the target and `prescriptionId`;
suggestions (direct / held / offline / no target) now asserted on the Add set
row; deleting the only set falls back to "tap the name to start"; End
session opens/hides/finishes and closes the pad; storage-failure row returns.

E2E scripts updated to the new flow but **not run** (they hit the live
instance): e2e-session, e2e-offline, e2e-backoff, e2e-video-required (tap Add
set where they relied on the auto-row; e2e-session finishes via End session).
docs/suggestions.md and docs/programs.md updated; app/design athlete frame
shows the button.

### Manual test on the real app (390 × 852 phone)

1. Free session: add Squat, enter 100 × 5, tick. Set 1 shows logged, **no Set
   2 row**, rest timer starts, pad closed, `+ Add set` visible.
2. Tap `+ Add set`: Set 2 appears with 100 × 5 and a live confirm square. Tick
   it; again no row appears.
3. With Set 1 logged, tap Add set twice, edit Set 3 to 80. Tick Set 2: Set 3
   (80) becomes the confirm row. Tick it: nothing new appears.
4. Prescribed day (e.g. 2 × 5 @ 75%): tick Set 1, no Set 2 row; Add set gives
   Set 2 at the prescribed load; after the last prescribed set, Add set
   repeats the last set.
5. Coach on **direct**, RPE line prescribed: log 170 × 5 @ RPE 7, Add set ->
   175 marked *Suggested* / "suggested from RPE 7 @ 170". Switch coach to
   **held**: Add set repeats 170, no marker.
6. Backoff line: log top set, Add set -> backoff load with "backoff from top
   set …" note. Repeat with the phone offline.
7. Delete the only logged set of an exercise: the block shows "No sets yet —
   tap the name to start"; tapping the name opens Set 1.
8. Scroll to the bottom: **End session** sits under the last exercise, clearly
   separate from Add set. Tap it -> confirm panel, button disappears. Keep
   going -> button returns. End session -> Finish -> summary.
9. Open the pad on a row, then tap End session: pad closes, panel shows.
10. Header clock still opens the same panel.
11. Video-required line: log both sets (Add set for the second); the nudge and
    clip attach behave as before.
12. Airplane mode: log, Add set, log, reload -- queued sets survive, nothing
    stranded.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
