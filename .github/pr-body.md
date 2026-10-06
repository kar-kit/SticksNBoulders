## Order 30 — Video-required prompt

Shared, P2, Source: Inferred. A coach can mark a prescription line "video
required"; the athlete is nudged, once, to film it. Never blocking.

### Behaviour

- **Program Editor:** a `Video` checkbox column after Note. It is in the arrow-key
  grid (arrow onto it, Space flips it) and saves as a one-field
  `updatePrescription`, like every other cell.
- **Storage:** `prescriptions.video_required`, boolean, in schema-as-code
  (additive; applied to the live instance with `npm run appwrite:setup`, one
  column created, nothing deleted). Writes stay server-only via `/api/program`.
- **Log Session:** while the flagged line's sets are still to do, that
  exercise's camera button is emphasised. Once they are logged with no clip on
  any set of the exercise, one `role="status"` line appears ("Your coach asked
  for a clip of this one.", with "Not now"). Attaching a clip, or "Not now",
  puts it away. No toast, no alert, no disabled confirm, Finish stays available.
- Logic is pure and tested in `lib/logging/video-prompt.ts`; sets read from
  Appwrite now carry `hasVideo` so a reload does not re-ask.

### Assumptions

- **[Inference]** "The line's sets" are counted positionally across the
  exercise's working sets (the way `targetsFor` already prices them), so a
  flagged top set is "done" after set 1 even if unflagged backoffs follow.
- **[Inference]** A clip on any set of the exercise satisfies the request,
  since the camera attaches to the most recent set.
- **[Inference]** Build Plan §5 / Set Row say a flagged set "won't tick
  complete" without a clip or a recorded skip. The Order 30 brief and
  constraint 4 say never block, so this does not. The older `videoRequired`
  gate on `LoggableSet` is untouched and unfed.
- **[Inference]** `Prescription.videoRequired` is optional in the type so
  concurrent Orders 20/21 fixtures do not conflict; the row parser always
  yields a boolean.

### Verification

- `npm run typecheck`, `npx eslint`, `npx vitest run`: all pass (115 files, 1820 tests, 15 new).
- `npm run e2e:video-required` against the live instance (`next dev --webpack`): 17/17.
  Covers keyboard toggle, stored boolean, reload, stranger 403, direct client
  writes refused (stranger and coach), emphasised camera, single status nudge,
  clip attach clearing it, Finish still enabled.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
