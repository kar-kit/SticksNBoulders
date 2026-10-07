## Roster: videos lead the "needs you" list

Ruairi answered blueprint 10's open question (form, 6 Oct 2026): his review
day is "Watch videos, analyse weaknesses and then adjust program accordingly".
Video review goes first.

### What changed

- `KIND_ORDER` in `lib/coach/roster-triggers.ts` is now videos, unprompted max,
  missed sessions, no bodyweight. The other three keep their relative order;
  every `TRIGGER_RULES` threshold is untouched.
- The header and the `KIND_ORDER` comment now label only "videos first" as
  [Fact] (source: Ruairi's form answer, 6 Oct 2026). The order of the rest and
  all thresholds stay [Inference].
- `docs/roster.md` states the new order and the fact/inference split, and drops
  the stale claim that `fetchProgramSignals` "returns nothing yet". It is wired
  (`lib/coach/roster-store.ts`, `lib/coach/program-signals.ts`), so the
  unprompted-RPE-10 and missed-session triggers are live.

### Checked, not changed

The Roster renders `needsYou()`'s output as it comes. `NeedsYou` in
`components/coach/roster.tsx` maps the items without re-sorting, and the table's
own sort (`lib/coach/roster.ts`) is over athlete rows, not trigger kinds. There
is no second hard-coded order. `scripts/e2e-roster.mts` does not pin the order.

### Tests

`npm test` 2021 passed (127 files; 2020 on dev before this branch), `npm run
lint` and `npm run typecheck` clean. The ordering test now pins videos first and
the unchanged relative order of the rest. No e2e or Appwrite script was run.
