## Order 28 — Coach toggle for next-set suggestions

The coach decides, per athlete, whether the logger suggests the next load from the athlete's own RPE or holds suggestions back. The Build Plan calls this a coaching philosophy question, so the product leaves the answer to the coach. This is not an AI coach. The switch exists so the coach stays in control.

**Source: Inferred.** Treated as a proposal, so the interpretation below is labelled and kept as small as it can be.

### What "held" means

**[Inference]** The Profile blueprint offers *"Athletes see them directly"* vs *"Hold for my approval"*. Nothing specifies an approval queue (who approves, when, on which screen), and an athlete resting two minutes between sets can't wait on one. So:

- **direct**: the logger shows the Order 27 engine's suggestion, ranked second in prefill and marked *suggested from RPE 7 @ 170*. It stays editable, and the note drops as soon as the athlete types a load.
- **held**: the logger shows no suggestion. The next row repeats the last set (prefill rule 3), which is how the logger behaved before Order 27.

**[Inference]** The switch is **per linked athlete**, not one per coach. A coach may trust a veteran's RPE and not a novice's. It lives on the **Athlete View**. **Profile & Settings** tells the athlete when their coach holds suggestions and tells a coach where the switch is.

**Default: direct**, as instructed for this ticket. **[SME to confirm]** The blueprint says to ask Ruairi rather than ship a default. Changing it only means changing `DEFAULT_SUGGESTION_MODE`.

### No athlete sees a suggestion yet

The engine has no default target on purpose (docs/suggestions.md). Targets come from prescriptions, and prescriptions reach the logger at Order 22. `lib/logging/set-targets.ts` is that seam and returns null for now. Everything downstream of it is wired and tested: the switch, the gate, the engine and the prefill note. The Athlete View says so in one line, so the coach isn't left wondering why nothing shows.

### Storage and who can write it

- `suggestions_mode` (`direct` | `held`, optional, default `direct`) is a column on **`coach_athlete_links`**. That row is already unique per pair and readable by exactly the coach and the athlete, and nobody can write it from a client. Re-linking reuses the row, so the coach's choice survives an unlink and re-link.
- Writes only go through **`POST /api/link/suggestions`**. The caller comes from the Appwrite JWT and never from the body. Only the coach on an **active** link qualifies. The route refuses the athlete (even for their own link), a stranger, and a revoked coach. It checks the link record rather than circle membership, the same rule `/api/reference-max` follows. Authorisation runs before validation, so a stranger gets 403 even for a malformed mode.
- The write helper `setLinkSuggestionMode` writes only that one column. It never touches status or dates, and it re-stamps link permissions from the policy.
- This avoids the forged-owner-field problem the parallel integrity fix is addressing, because no client-created row is involved.

### Audit rule this storage needs

`rules.ts` is on unmerged PR #36, so the rule is described here. For `coach_athlete_links`:

1. **Table permissions are `[]`**, so no client may create a row.
2. **Every row's permissions are exactly `[read("user:<athlete_id>"), read("user:<coach_id>")]`**, matching that row's own `athlete_id` and `coach_id`. No `update`, no `delete`, no team or `users` read.
3. **`suggestions_mode` is null, `direct` or `held`.**

Rules 1 and 2 are what make the route the only way to change the switch. `e2e:suggestions` checks both on the live instance.

### Offline

The athlete's logger reads its active link rows straight from Appwrite and caches the answer on the device (`snb.suggestion-mode`, keyed by athlete id). It re-reads on load, on `online`, and when the app comes back to the foreground. A failed read never changes the cached value.

**[Inference]** A device that has never read its link row (a fresh install opened with no signal) assumes **held**. Showing a suggestion the coach switched off is the failure this toggle exists to prevent. Withholding one costs the athlete one number typed, and the first read with signal corrects it. In that case Profile doesn't claim the coach held anything.

### Schema

v9 adds one optional column. I applied it to the live instance with `npm run appwrite:setup` ("Applied 1 change(s)"). No data was rewritten or deleted.

The setup script also reports orphans that predate this branch: `programs`, `program_blocks`, `program_weeks`, `program_days` and `prescriptions` tables, plus `sessions.program_day_id`, `sets.prescription_id` and `sets.prescribed`. They're presumably from the Order 19 work. I left them untouched, as the script always does.

### Tests

- **vitest: 1584 passed** (1533 on `dev`, +51). New coverage:
  - Route authorisation, 14 tests. These run the real admin module through the real route, with the JWT check and tables faked at the edges: no token, a bad token, the athlete, a stranger, a revoked coach, another coach, a coach id smuggled in the body, a bad mode, malformed bodies, and Appwrite down.
  - Logger gating, 9 tests in `log-screen.test.tsx`: direct suggests 175 from 170×5 @ 7, held repeats 170, a pre-Order-28 link reads as direct, typing a load drops the note, a held cache keeps working offline, so does a direct cache, another user's cache is ignored, a never-told device suggests nothing and still logs, and no target means no suggestion.
  - The gate, plan, write helper, schema, Athlete View switch and Profile note.
- **tsc** (`npm run typecheck`) and **eslint** are clean. The write-helper guard test passes.
- **`npm run e2e:suggestions`: 29/29 against the live instance.** It covers the default, route authorisation, client-side writes refused for the athlete, the coach and a stranger, read access for exactly the two parties, the coach changing the switch on the Athlete View, the athlete's Profile note, the logger caching the mode, the cache surviving an offline re-read, and the device picking up a change when the signal returns.

Flaky test: `review-queue.test.tsx > shows the reason on the empty screen when the last athlete leaves` failed once in about seven runs and passed on every rerun. That file isn't touched by this branch.

### Not done, on purpose

- No approval queue. If Ruairi wants one, it's a separate ticket that can reuse "held" as its starting point.
- No coach-wide "apply to all athletes" switch.
- No prescription targets. That's Order 22.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
