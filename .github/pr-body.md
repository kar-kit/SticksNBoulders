## fix(units): apply the athlete's kg/lb preference

The Pounds setting on Me was saved to the profile and nothing ever read it. An athlete who picked Pounds and typed 225 stored **225 kg**. This is finding B3 in the 9 Oct test audit, which calls it the most likely way a wrong load gets into the system.

### Semantics (Joey's decision, pending confirmation)

- **Storage stays kilograms everywhere.** There is no schema change, no migration, and nothing changes for the coach.
- **Athletes type and read weights in their chosen unit.** The conversion happens at the screen boundary and nowhere else. A typed number becomes kilos on its way in (`loadFromInput`), and kilos become the athlete's unit on the way out (`loadIn`), both in `lib/units.ts`.
- **No round-trip drift.** In pounds the pad takes one decimal and the screen shows one decimal. Stored kilos are rounded to the gram, which is 0.0022 lb and well inside the 0.05 lb that would change a one-decimal display. A test checks every tenth from 0 to 1,500 lb, and each one reads back exactly as typed. Kilos keep the two decimals the logger has always used, and the kilo path is unchanged.
- **Plate rounding in pounds: 5 lb, rounded down.** A weight the app works out for the athlete (a percentage, an RPE suggestion, a backoff) is floored to a multiple of 5 lb for a pound athlete, instead of 2.5 kg. That is the 2.5 lb plate pair, the smallest a commercial pound gym reliably has, and the nearest pound equivalent of the 2.5 kg step (5 lb = 2.27 kg). It rounds down for the same reason the kilo version does. Example: 75% of a 203 kg training max is 152.25 kg, which is 335.7 lb, so the target is 335 lb, stored as 151.953 kg.

### What changed

**Plumbing**
- `lib/profile/units-context.tsx` (new): `UnitsProvider` plus `useUnits()`, mounted in the athlete providers. It starts from the unit this device last cached for the account, so a reload with no signal still reads pounds. Then it reads the profile with a plain read (`fetchProfile`, not `ensureMyProfile`, because opening a screen should not write a row). A failed read leaves the cached unit in place. A unit picked on Me applies everywhere at once, and a slower read that arrives afterwards cannot undo it. Outside the provider, which covers every coach screen and the existing tests, the unit is kg.
- `lib/units.ts`: adds `loadIn`, `loadFromInput`, `loadNumber`, `loadLabel`, `unitName` and `LOAD_DECIMALS`. The existing helpers are untouched.
- `lib/strength/plates.ts`: `roundToLoadable(kg, unit = "kg")` and `LOADABLE_INCREMENT_LB = 5`.
- An optional `unit` parameter, defaulting to kg, is threaded through `suggestLoad`, `nextSetSuggestion`, `resolvePrescription`, `resolveExercise`, `targetsFor`, `backoffLoad`, `backoffDisplay`, `backoffNote`, `prescribeNewRows`, `resolvePrefill`, `rowAfter` and `addRow`.

**Every athlete surface that enters or shows a weight**

| Surface | In | Out |
|---|---|---|
| Log Session: set rows, column header, number pad (label, decimals) | ✓ | ✓ |
| Log Session: target lines, "Next:" line, suggestion and backoff notes, Session done tonnage | | ✓ |
| History list (tonnage) and session detail (rows, edit pad, tonnage) | ✓ | ✓ |
| Lift Detail: e1RM, change, PRs, recent sets | | ✓ |
| Today and My Program target lines | | ✓ |
| Bodyweight: entry, headline, 7-day average and change, placeholder, recent list, range-error message | ✓ | ✓ |
| DOTS block: total breakdown and stale bodyweight (athlete only, through the provider) | | ✓ |
| Coach Feedback: the set the comment is on | | ✓ |

On bodyweight, `checkWeight(value, unit)` keeps a pound reading to one decimal in pounds and stores it to the gram. The old rounding to 0.1 kg would have turned 180 lb into 179.9 lb on read-back. The plausible range is still 20 to 400 kg, which the message gives as 44.1 to 881.8 lb.

### Still in kilograms, and why

- **Every coach screen** (roster, athlete view, current maxes, review queue, clip context, program editor). The coach side has no provider, so it renders kg as before. Applying a coach's own preference there was not trivial: those screens mix the coach's profile with the athlete's data, and nobody has asked for it.
- **The prescription snapshot a logged set keeps** (`prescribed`). The coach reads it back in clip context and the CSV, and storage is in kilos. A pound athlete's "Next:" line uses a separate `shown` field in pounds, so the athlete never sees the kilo version.
- **CSV export.** The header says `Load (kg)` and `e1RM (kg)`, so the unit is never ambiguous. The file is shaped for Ruairi's spreadsheet, and switching columns by athlete would break his formulas. The snapshot text in it is also in kilos.
- **DOTS itself** is calculated in kilos. Only what the athlete reads is converted.
- **Charts** (e1RM, bodyweight) have no axis numbers, and a linear rescale does not change their shape.

### Testing

- `npm test`: 171 files, **2,680 passed** (2,630 before, plus 50 new). `npm run lint` is clean, and so is `npx tsc --noEmit` after `npx next typegen`.
- **Unit tests:** conversion helpers, including the exhaustive pound round trip and gram storage; pound plates; the suggestion engine and gate; the pad's pound decimals; targets, snapshots and `targetLine` in pounds, including a reference lift and backoffs; the prefill note; bodyweight's check, its no-drift sweep and its message; the DOTS breakdown; and the provider's cache, account isolation and the race with a slow read.
- **Component tests:** the real `UnitsProvider` wrapped around `LogScreen` shows that **225 lb typed on the pad reaches `logSet` as `loadKg: 102.058`** and reads back as 225, including on the prefilled next set and on its pad. Further tests cover a History correction typed in pounds and written as kilos, a set row and header in pounds, a Bodyweight entry passed as pounds, and Lift Detail, Today and History tonnage in pounds.
- **Failing first:** with the logger, set row, pad and block reverted to `dev`, all three pound tests on the log screen fail.
- **Mutation check:** 26 one-site mutations, each reverted after its run, and **26 killed**. They include the original bug (pad entry not converted), the pad opening on stored kilos, pounds stored to 0.1 kg, pound plates on the kilo increment, the gate dropping the unit, the snapshot losing its kilos, `targetLine` showing kilos, the backoff note in kilos, the bodyweight screen dropping the unit, the provider ignoring its cache, a stale read winning, and Lift Detail, DOTS, History tonnage and Today targets left in kilos. History tonnage and Today targets survived the first pass, so I added tests for both in the second commit.
- **Not pinned by a test:** the DOTS block and Coach Feedback card components (`formatTotalBreakdown` underneath is pinned), the My Program screen (it makes the same `targetsFor` call as Today), and the Session done tonnage.

### Decisions for Joey

1. **Confirm the semantics above.** They are your call, and I have treated them as pending.
2. **Existing data [Unverified].** If any athlete already picked Pounds and logged sets before this merges, those sets hold pound numbers in kilo columns. After this fix they will show about 2.2× too heavy. To check: list `profiles` with `units = "lb"` and compare their sets' `logged_at` against the merge date. I did not run anything against the live instance. If any turn up, the fix is a one-off `÷ 2.2046` on those rows plus `rollups:rebuild`.
3. **5 lb, rounded down** for derived weights in pounds. [SME to confirm] with Ruairi, alongside the existing 2.5 kg increment. Micro-plates would argue for 2.5 lb.
4. **A coach's fixed kilos are converted, not re-rounded.** For example, 140 kg reads as 308.6 lb, and the athlete loads whatever their plates allow. The alternative would floor it to 305 lb, which quietly changes the coach's number.
5. **Pound entry takes one decimal, not two.** Pound totals move in 0.5 lb steps even with micro-plates, and this restriction is what makes the round trip exact.
6. **Switching unit mid-session.** Rows already on screen keep their stored kilos and display converted. Only new rows are priced on the new plates. I think this is right, because re-pricing a row under the athlete's thumb is what `prescribeNewRows` already refuses to do.
7. **The 7-day bodyweight average** is still worked out on weigh-ins rounded to 0.1 kg and then converted. It can sit up to about 0.1 lb from an average taken in pounds. [Inference] This is a display-only difference and not worth reworking `rollingAverage` for.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
