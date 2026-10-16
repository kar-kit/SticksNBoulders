# SticksNBoulders

Powerlifting coaching software — programming, logging and video review. An installable PWA where athletes log sets in the gym (offline, on bad wifi, with a phone that might die mid-session) and a coach prescribes work, watches lift footage and leaves feedback.

**Stack** — Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Appwrite (self-hosted) · Zod · Vitest · Playwright

35,067 lines · 1,188 tests across 75 files · 16 browser-driven end-to-end scripts that run against a live backend.

---

## What's interesting in here

**One write path, enforced by a test that greps the tree.**
The permission model rests on a single claim: nothing writes a row except [`appwrite/documents/write.ts`](appwrite/documents/write.ts). Appwrite has no joins, so `athlete_id` is denormalised onto every set — and if that copy and the row's permission stamp were written in two different places, one would eventually be right and the other wrong. The symptom would be a coach seeing someone else's training.

So [`guard.test.ts`](appwrite/documents/guard.test.ts) asserts it as a property of the source tree: it shells out to `git ls-files` (including *untracked* files, since an uncommitted bypass is exactly the one worth catching), then greps every `.ts`/`.tsx`/`.mts` file for the ten Appwrite row mutators and fails with the offending path and the reason. ESLint enforces the same rule at commit time; this survives someone disabling the rule. It also checks that no secret ever gets a `NEXT_PUBLIC_` prefix — Next inlines those into the client bundle, so prefixing the admin key would ship it to every athlete's phone. And it asserts it found files to check in the first place, so a broken glob can't pass vacuously.

Permissions themselves live in [`policy.ts`](appwrite/documents/policy.ts) as pure functions — no client, no network — because Appwrite has no row-level security policy to audit, only the strings each row was stamped with at write time. That file *is* the policy, which makes it exhaustively testable.

**Offline-first logging with a durable write queue.**
Nothing on the logging path waits for the network. Every write lands in an IndexedDB queue first ([`lib/offline/idb-store.ts`](lib/offline/idb-store.ts)) and `logSet` resolves once the op is on disk — not once the server has it. The client mints the Appwrite row id, which makes every op idempotent: a retried flush writes the same row twice with no duplicate and no reconciliation step.

`navigator.onLine` is treated as a hint and never as a gate, because it reports whether an interface is up, not whether Appwrite is reachable — and gym wifi that associates but routes nowhere reports online all session. Writes are always attempted; the real signal is the attempt failing. Failures are classified `done` / `retry` / `permanent` and retried on exponential backoff; only the *ready prefix* of the queue drains, so ordering holds. A create still sitting in the queue collapses with a later edit to the same row rather than both being sent. The sequence counter is rebuilt from disk on load, so ops written before a reload keep their place ahead of new ones.

All of that decision logic is pure and lives in [`queue.ts`](lib/offline/queue.ts), tested without a browser; [`client.ts`](lib/offline/client.ts) is only the wiring. → [`docs/offline.md`](docs/offline.md)

**Aggregates designed around a database that can't aggregate.**
Appwrite has no `GROUP BY`. Rather than fan out reads, weekly rollups are materialised — one row per athlete, per exercise, per week — and always *recomputed from source sets*, never incrementally adjusted. Incremental is faster and wrong: it can't survive an undo, a correction, or the same set arriving twice from a retried queue. The live path and the repair path are the same code. → [`docs/rollups.md`](docs/rollups.md)

**Sports-science formulas implemented from the papers.**
Estimated 1RM via Brzycki against *reps-to-failure* rather than reps performed — `RIR = 10 − RPE`, `e1RM = load × 36 / (37 − reps − RIR)` — computed and stored at write time, because with no `GROUP BY` nothing can derive it on read ([`lib/strength/e1rm.ts`](lib/strength/e1rm.ts), [`docs/e1rm.md`](docs/e1rm.md)). Alongside it, DOTS bodyweight normalisation applied per-lift rather than to the traditional three-lift total ([`lib/dots.ts`](lib/dots.ts)) — implemented and unit-tested, currently unwired; the competition layer it was built for was cut in favour of the coaching features.

**Resumable video upload, built for the network it runs on.**
Lift footage uploads in chunks at Appwrite's server-validated chunk size ([`lib/video/chunks.ts`](lib/video/chunks.ts)). Progress is tracked as a *count* of completed chunks rather than a map of byte ranges, because uploading strictly in order means `n` completed chunks is a resume point — a simpler invariant that makes recovery from a dropped connection trivial. Pending uploads survive a page reload in their own IndexedDB store. → [`docs/video-upload.md`](docs/video-upload.md)

**Infrastructure as code, against a real backend.**
The entire Appwrite schema — 11 tables, indexes, permissions, storage buckets — is declared in TypeScript and applied by a planner/executor pair that diffs desired state against live state ([`appwrite/schema/plan.ts`](appwrite/schema/plan.ts), [`execute.ts`](appwrite/schema/execute.ts)). Backup, restore, reset and seed all run through the same driver. This is the part most people click past; it's the part that made everything else possible.

**Derived ids as constraints.**
Ids are computed from what they identify rather than generated, which turns a uniqueness rule into an arithmetic fact: `circleTeamId(athleteId)` ([`appwrite/documents/circle.ts`](appwrite/documents/circle.ts)) means an athlete's circle needs no lookup to address, and it throws rather than truncating if the result would exceed Appwrite's 36-character id limit — a rejected write with a clear message, instead of a collision that looks like a permissions bug months later.

**Verification that touches the real instance.**
1,188 unit tests (Vitest) cover the pure logic. Alongside them, 16 Playwright scripts (`npm run e2e:*`) drive a real browser against a live Appwrite instance and assert things unit tests structurally cannot — that a set logged with Appwrite unreachable still reaches the coach after reconnect, that row-level permissions actually deny what they claim to, that a chunked upload resumes byte-for-byte. Each creates a throwaway athlete and cleans up after itself.

---

## Architecture

```
Next.js 16 App Router  ──►  Appwrite (self-hosted)
  app/(athlete)               Auth · TablesDB · Teams · Storage
  app/(coach)
  IndexedDB write queue
  IndexedDB upload queue
  localStorage cold-start cache
```

Route groups split the two audiences: `app/(athlete)` for logging, history and per-lift progression; `app/(coach)` for roster, programs and the set-review queue. Server-side Appwrite access goes through a scoped admin client; browser writes go through a separate writer carrying the user's session, so row-level permissions are enforced by the database rather than by the UI. Coach ↔ athlete membership is modelled with Appwrite Teams.

`lib/` is organised by domain — `strength` (2,349 lines), `logging` (2,203), `auth` (1,402), `video` (1,292), `review` (1,135), `offline` (1,006), plus `programming` (890), `exercises` (699), `coach` and `profile`. Each splits pure logic from anything touching the network, which is why 1,188 tests run in 17 seconds.

Queries are shaped around the same missing joins. The coach's review queue is two reads and a subtraction — every set with a clip, minus every review this coach already wrote — and the `isNotNull` filter it depends on was verified against the live instance first, because if it hadn't composed the queue would have needed a denormalised `has_video` column and a backfill. The coach reads through the circle team exactly as they read everything else, so no code branches on who is asking and the whole screen stops working the moment a link is revoked.

## Feature surface

Session logging with a rest timer, number pad and RPE sheet · per-lift progression charts · RPE/RIR-based e1RM and reference maxes · load suggestions from recent work · coach ↔ athlete links via invite codes · prescribed programs · a set-review queue with comments and clip playback · video attachments with resumable chunked upload · PWA install with offline logging · backup and restore tooling.

## Running it

```bash
npm install
npm run dev              # http://localhost:3000

npm test                 # 1,188 tests, 75 files
npm run typecheck
npm run appwrite:setup   # apply the schema to a fresh Appwrite project
```

Environment variables are documented in `.env.example`. A self-hosted Appwrite project is required for full functionality; the front end and all pure logic run without one.

## Notes

Design decisions are written up in [`docs/`](docs/) — 17 documents covering the offline queue, rollups, e1RM, the review queue, invite codes, backups, video upload and the Appwrite event model. They record *why*, including approaches that were tried and rejected.

There is no CI pipeline in this repository; the test and typecheck commands above are run locally before merge.

Private project, hosted on personal infrastructure. No public deployment.
