## Order 21 — Backoff rules

Coach, P2, **Source: Inferred**, Program Editor. A coach attaches a backoff rule to a prescription line; in the logger, once the athlete logs the top set, the backoff sets' targets are computed from **that actual set** and prefilled. Every number stays editable. This is the coach's rule executed on the phone, never generated, and it works with no signal.

### What the coach types (Backoff cell, after Note)

| Typed | Stored | Means |
| --- | --- | --- |
| `3 x 90%`, `3x-10%`, `90% x 3` | `3 x 90%` | 3 sets at 90% of the top set's load |
| `-5% until @9` | `-5% until @9` | top-set load −5%, repeat until a set is logged at RPE ≥ 9 |
| `repeat until @9` | `repeat until @9` | top-set load again, until RPE ≥ 9 |
| `… max 4` | `… max 4` | caps a drop run (default 5) |

The cell shows what the rule does ("3 sets at 90% of today's top set"). A rule that can't be executed (above 100%, a drop of 50% or more, an RPE not on the chart, words) gets refused on the cell and by `/api/program` (400). Unlike the load cell, there's no freeform fallback, because freeform can't be executed. That text belongs in Note.

### Formulas, all [Inference]

- **Top set** is the heaviest non-warm-up set logged against the line's own set slots. On a tie, the later set wins. Warm-ups never count, however heavy.
- **Percent rule:** `load = roundToLoadable(topLoad × p/100)`
- **Drop rule:** `load = roundToLoadable(topLoad × (1 − d/100))`, the same load for every set in the run
- Rounding reuses Order 18's `roundToLoadable` (down to 2.5 kg). One exception: 100% / `repeat` keep the top set's exact load, which is already on the bar.
- **No top set logged yet:** no load. The athlete reads "90% of top set" and the row falls back to repeating. No stored max stands in.
- **Drop run length:** grows one set at a time. The set that reaches the stop RPE ends the run (that set counts). A set logged without an RPE can't end it. The cap ends it regardless.
- Freeform and no-load top lines work, because the rule needs only the athlete's logged load.

### Questions for Ruairi [SME to confirm]

1. **Fatigue %: measured on load or on e1RM?** I've implemented it on **load** ("load drop"). RTS also describes stopping when e1RM has fallen X% from the top set. If that's what he uses, it's a third rule kind.
2. Is "top set" the **heaviest** set of the line, or the **last** one (e.g. a 2 × 3 @8 top line)?
3. Do backoffs always use the top set's reps? Right now they inherit the line's reps. Different reps means a separate line.
4. Is the 5-set default cap on drop / repeat runs right? Should runs have a cap at all?
5. Does a drop rule end at RPE **≥** Y, or only once the athlete hits Y exactly?
6. Rounding: still down to 2.5 kg (same open question as Order 18)?

### Storage

- New optional `prescriptions.backoff` column (string 40), schema v11. **Applied to the live instance** with `npm run appwrite:setup`. Additive only: nothing deleted, existing rows untouched. A line with no backoff writes exactly what it did before.
- Writes stay server-only: it's a Zod field in `lineFields`, normalised to canonical text in `program-write.ts`.
- Copies (Order 20) carry the rule. It's text on the line, not a row id, so nothing goes in `LINE_PLACEMENT`. I've added a copy test.

### Logger

- `targetsFor` appends backoff slots after the line's own sets, carrying `backoff: { rule, topSet }`.
- `prescribeNewRows` prefills new rows as the coach's number, with the note "backoff from top set 185 × 3".
- `setTargetFor` (the set-target seam) returns null for backoff sets, so the suggestion engine never argues with the rule.
- `lineSummaries`: "1 × 3 · RPE 8, then 3 × 3 · 165 kg (90% of top set)".
- `videoAsk` (Order 30) counts backoff slots as positions, so a flagged line after a backoff isn't asked for early.

**Known limit:** rows already on screen are never re-priced (existing rule). A backoff row planned with *Add set* before the top set was logged keeps its repeated load, and the athlete edits it.

### Also in this PR

- **fix:** `roundToLoadable` lost exactly loadable weights to float error. For example, 70% of 175 came out as 122.49999… and floored to **120 instead of 122.5**. This affected the existing percent resolver and the suggestion engine too. I added a sub-gram slack. The rule itself is unchanged.
- Merges of `origin/dev` (#41, #42 Order 30, #43 Order 20). Both new columns are kept; COLUMNS is now `… notes, backoff, video`.

### Tests

- tsc, lint and the full vitest suite all pass (**1903 tests, 120 files**).
- **37** unit tests in `lib/programming/backoff.test.ts`, plus new tests in plates, set-targets, program-admin, program-copy, schema, video-prompt and the editor grid.
- `npm run e2e:backoff` against the live instance (`next dev --webpack`): **15/15**. It covers the editor cell, canonical storage and the read-only stamp, route 400/403, Today before a top set, an **offline** top set of 185 prefilling 165 on the next row, queued sets landing with the rule's snapshot, and the coach changing the rule without touching logged sets.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
