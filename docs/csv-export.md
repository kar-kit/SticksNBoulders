# CSV export

Order 39. P2, Source: Inferred. Profile & Settings (DATA) and Athlete View.

Constraint 6 in CLAUDE.md: the freeform prescription and CSV export exist
because **the competition is Excel**. Ruairi said Excel keeps winning because
"then we both have access to stuff" and because it does whatever he builds into
it. An export does not beat Excel; it removes a reason to keep the spreadsheet
open "just in case".

## What shipped

- **Athlete**, on Me → DATA: "Export your training log".
- **Coach**, on Athlete View: "Export their training log", for that one athlete.

Same component, same code path (`components/export/export-log.tsx`). The only
difference is how the file is handed over: the athlete's phone gets the share
sheet when it can take a file (an iPhone PWA launched from the home screen
ignores `<a download>` for blobs and shows the CSV as a page of text); the
coach's laptop gets a plain download.

## One row per set

| Column | From | Notes |
| --- | --- | --- |
| Date | session `started_at` | ISO `YYYY-MM-DD`, the London calendar day, like rollups and History |
| Session | derived | 1 = the athlete's first session, oldest first |
| Exercise | `exercises.name` | resolved by id, so a coach-created exercise still gets its name |
| Set | `set_index` | 1-based, counts warm-ups, as the logger numbers them |
| Load (kg) | `load_kg` | always kg; units live in the header so cells stay numeric |
| Reps | `reps` | |
| RPE | `rpe` | blank means the athlete tapped "not sure" |
| Warm-up | `is_warmup` | `Yes` / `No` |
| e1RM (kg) | `e1rm_kg` | stored value, one decimal |
| Notes | `sets.notes` | |
| Prescription | — | **always blank today**: prescriptions have no table until Order 19 |
| Session notes | `sessions.notes` | [Inference] not in the ticket; added so "full log" means full |

One row per set, not a pre-aggregated layout, because a set table is what a
pivot table can do anything with. The Prescription column ships empty so the
layout does not move under anyone's formulas the day Order 19 fills it.
`buildLogRows` already takes a `prescriptionFor(set)` lookup for that.

## Excel and Sheets

`lib/export/csv.ts`, pure and tested:

- **UTF-8 BOM** (`EF BB BF`), or Excel on Windows reads the file as the system
  code page and mangles accented names.
- **RFC 4180 quoting**: a cell with a comma, quote, CR or LF is quoted, inner
  quotes doubled. CRLF between rows.
- **Formula injection neutralised**: text starting with `=`, `+`, `-`, `@`, tab
  or CR gets a leading `'`. Notes and typed exercise names are text one person
  wrote landing in another person's spreadsheet. Numbers are never touched, so
  SUM still works.
- Booleans as `Yes`/`No` rather than `TRUE`/`FALSE`, which some locales'
  Excel does not parse.

## Paging, and not freezing the phone

`lib/export/paginate.ts`: cursor pagination to the end, 500 rows a page,
ordered by `$id` so a page boundary cannot fall between equal timestamps.
Stops on a short page, throws on a cursor that does not advance or on a
page ceiling, and never returns a partial log on a failed page. `ttl: 0` so an
export never serves a cached page.

Serialising yields to the main thread every 500 rows (`scheduler.yield` where
available, a zero timeout on Safari) and builds a list of parts that go
straight into a `Blob`, instead of one multi-megabyte string concatenated in JS.
No Web Worker: at this data size the fetch is the slow part, and it is already
async.

## Permissions

Nothing in the export decides who may read what. Every read runs as the
signed-in user through the browser client, and sets/sessions carry row read
for the athlete and their circle team only. So an athlete gets their rows, a
linked coach gets that athlete's rows, and a stranger or a revoked coach gets an
empty file's worth of nothing from Appwrite. The `athlete_id` filter narrows
the query; it is not the privacy boundary. No schema change.

## Not in this ticket

- **Sets still in the offline queue** are not in the file: the export reads
  Appwrite. An athlete exporting with sets pending gets them next time.
- **Prescriptions** (Order 19), **bodyweight** and **coach comments** are not
  exported. Each would be a second file or a different row shape.
- **Pounds.** Loads export in kg regardless of the profile's units setting.
- **Roster-wide export** for a coach. One athlete at a time, per the ticket.
- **Cronometer / MyFitnessPal formats** (Build Plan §11) are a different export.

## Verified against the instance

`npm run e2e:export` — 14 checks, running the exact function the button runs
through real user sessions: 520 seeded sets across 26 sessions all exported
(crossing the 500-row page), BOM, header, ISO date, a comma/quote/newline note
kept as one cell, a formula-shaped session note and a `-`-prefixed exercise name
neutralised, the linked coach getting the identical file, a stranger getting
nothing, and a revoked coach losing it. Removes every row it wrote.

## Files

| File | What it holds |
| --- | --- |
| `lib/export/csv.ts` | Pure serialiser: BOM, quoting, injection, chunked parts |
| `lib/export/paginate.ts` | Cursor pagination to the end |
| `lib/export/training-log.ts` | Pure: columns, row order, dates, file name |
| `lib/export/training-log-store.ts` | Appwrite reads, Zod-parsed |
| `lib/export/export-log.ts` | Fetch → rows → CSV, and handing the file over |
| `components/export/export-log.tsx` | The DATA section, both surfaces |
| `scripts/e2e-export.mts` | The claims, live |
