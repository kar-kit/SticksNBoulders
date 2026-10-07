## FTP1 — publish and unpublish one week at a time

Ruairi writes "a mix depending on the athlete": a whole block up front for some, a week at a time for others. The data model already carried it (per-week `status`, per-day `scheduled_on`), but the editor only had the whole-program Publish button and nothing called `updateWeek {status}`. This adds a per-week Publish / Unpublish button beside the week tabs.

### What changed

- **`publishWeek {weekId}`** (new op, `program-admin.ts`): publishes one week and, if the program is still a draft, publishes the program with it. Without that, the first week of a week-at-a-time block would be "published" under a draft program and reach nobody. Week first, program second, as `publishProgram` does, so a failure between the two shows the athlete nothing and a second press finishes it. Templates are refused, as for `publishProgram`.
- **Unpublish is the existing `updateWeek {status: "draft"}`.** [Fact] The server op and write helper already allowed published to draft: the schema enum is `draft | published`, there is no transition guard, and `updateProgramWeek` passes `status` through. Not widened; now tested. The program stays published, so the other weeks are untouched. Rows are not removed or re-stamped.
- **Program Editor**: one ghost button next to Duplicate, labelled "Publish week N" or "Unpublish week N". Insert-only diff (19 lines) in `program-editor.tsx`. Read-only for non-coaches, as the rest of the grid.
- **Permission audit** (`scripts/appwrite-audit.mts`, `docs/permission-audit.md`): coach round-trips a week; unlinked coach, B, A and anon are refused; the ex-coach is refused after revocation. Not run live.
- **`docs/programs.md`**: publish/draft bullets updated, including the edit-while-unpublished workflow.

### Constraint 5

- Program writes still never touch `sessions` or `sets`. New test publishes, unpublishes, edits a line and republishes with a logged session and set present, asserts no write to either table, and that both rows are unchanged (`prescription_id` and the `prescribed` snapshot included).
- Mid-session: [Fact] the logger loads its day by id with no published check (`fetchPrescribedDayById`), so unpublishing under an athlete changes nothing already on their screen. `prescribed-day.test.ts` covers that and that Today stops offering the day while it is draft.

### Decisions to confirm

- [Inference] `publishWeek` on an archived program publishes it again, matching what `publishProgram` does today. No restore flow exists.
- [Inference] Unpublish has no confirm step: it deletes nothing and Publish reverses it.
- [Inference] Unpublishing the last published week leaves the program published; Today shows nothing for it.
- [SME to confirm] Whether Ruairi wants edits to a published week held in draft by default. Not built; not asked for.

Not added: any session-by-session flow beyond the existing per-day `scheduled_on`.

### Verification

`lint` · `typecheck` · **2030 tests, 128 files**. No e2e or appwrite scripts run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
