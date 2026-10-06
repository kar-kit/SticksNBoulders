## Order 20 — Duplicate week and copy program

Coach, P1, **Source: Inferred**, Program Editor. Kept small on purpose: no
templates library, no bulk percentage shifting. Includes a merge of `dev`
(#41 flaky-test fixes, #42 Order 30 `video_required`).

### What's built

- **Duplicate week** — a button beside "+ Week". Appends a **draft** copy of
  the week on screen to its block: every day and line, days moved a week past
  the block's last week (+7 when duplicating the last week).
- **Copy to…** — in the editor header. Type the athlete (linked athletes plus
  "Yourself"), optionally "Only <this block>", pick a start date (defaults to
  the source's). Creates a new **draft** program and links to it.
- Both are ops on `POST /api/program` (`duplicateWeek`, `copyProgram`): verified
  JWT, no new tables, no client write path.

### Rules the copy follows

- **Authorisation on both ends** [Fact, unit + e2e]: the caller must be the
  source program's coach, still actively linked to its athlete, **and** able to
  program for the target (active link, or themselves). Refusals happen before
  any row is written.
- **Percentages stay percentages** [Fact, e2e]: loads are copied as typed, so
  `75%` on Andrea's copy shows 90 kg on her Today (75% of her 120), not Joey's
  150.
- **Exercises re-resolve in the target's library** [Fact, unit + e2e]: global
  stays global; the source athlete's private variation is found by name in the
  target's library or created there via the editor's `createExercise` path.
- **Generic line copy** [Fact, unit + e2e]: every prescription column except
  Appwrite's and placement columns is copied, so `video_required` (Order 30)
  and Order 21's future fields carry across untouched. A future column that
  holds a row id must be added to `LINE_PLACEMENT` and remapped (documented).
- **Logged work is never touched** [Fact, unit + e2e]: neither op reads or
  writes `sessions`/`sets`.

### Assumptions, each reversible

- **[Inference]** A duplicated earlier week lands after the block's last week
  (`7 × (weeks − index)` days), not on top of the following week.
- **[Inference]** The duplicated week's label is not copied (shows "Week N").
- **[Inference]** Fixed kilos are copied as written across athletes; the copy is
  a draft so the coach reviews it before publishing.
- **[Inference]** Copying with no start date keeps the source's dates; a block
  copy anchors on that block's first dated day.
- **[SME to confirm]** with Ruairi whether he copies blocks between athletes at
  all, or whether question 6/7 (templates) is the real need.

### Tests

- `lib/programming/copy.test.ts` — date maths (shift, anchor, DST).
- `appwrite/documents/program-copy.test.ts` — dates, percent re-targeting,
  exercise resolution, authorisation, generic column copy incl. `video_required`.
- `components/coach/copy-program.test.tsx` — the button and the form.
- `scripts/e2e-copy.mts` (`npm run e2e:copy`) — 20/20 against the live
  instance; `e2e:program` re-run 31/31.
- `tsc`, `eslint` clean; full vitest 118 files / 1848 tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
