## FTP1 — Ruairi's form answers (6 Oct 2026), recorded in the docs

Docs only. No code, no schema, no scripts. Each answer is recorded as a [Fact]
sourced "Ruairi form answer, 6 Oct 2026" and touches only the passage it
resolves.

### What each answer changed

- **e1RM vs RTS chart: "No preference"** (`docs/e1rm.md`, `docs/rpe-chart.md`).
  Resolves the [SME to confirm] on parity. Default is no change and no
  `e1rm:backfill`. [Inference] The answer removes the parity argument without
  arguing for Brzycki, and does not say whether he is RTS-trained. Moving to the
  chart (2.7%; 170 x 5 @ RPE 8 is 204.0 vs 209.6 kg) stays Joey's call.
- **Reuse across athletes: "Sometimes"** (`docs/programs.md`, the template
  bullet only). Copy to (Order 20) is the answer; no template library for the
  beta. The publish/draft section is untouched.
- **Backoffs** (`docs/programs.md`, Backoff rules). He picked RPE target and
  percentage drop from the top set, wants no fixed-kg kind, and left the example
  (4b) blank. The mapping onto `percent` / `drop` is [Inference] only; "RPE
  target" is ambiguous. The load-vs-e1RM and cap-of-5 [SME to confirm] marks
  stay open. The code comment in `lib/programming/backoff.ts` is not edited.
- **Video: "Mainly compounds, accessories/variations if you have questions"**
  (`docs/video.md`). Recorded as the default expectation. [Fact] The code has no
  compound/accessory concept; only the per-line `video_required` toggle exists.
- **Beta size: 5 athletes** (`docs/video-upload.md`). Recorded as an input. No
  capacity numbers added.

### Stale `docs/review-queue.md` claims corrected (checked against code)

- "Prescribed" line: the doc said it needed a programs table that did not exist.
  Programs shipped (Orders 19, 22) and `sets.prescribed` holds the snapshot;
  `fetchClips` already receives it but `toClip` drops it and `ClipContext` does
  not render it. Reworded as "absent but buildable".
- "Comment & next" is no longer pending Order 33; it shipped.
- Voice notes: pointer to `docs/comments.md` (recommended against).
- `e2e:review` count: 11 -> 21 (10 data path, 11 comments), per the script.

### Not edited, flagged

- `components/coach/clip-context.tsx` header comment repeats the stale "no
  programs table" claim. Code, so out of scope here.
- `docs/review-queue.md` "A bound worth writing down" and the `e2e:clip` count
  (15) were checked and still hold.
- Not touched by design: `docs/roster.md`, `docs/suggestions.md`, the "Why there
  is no table" passage in `docs/prescriptions.md`.
