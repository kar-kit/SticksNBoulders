## feat(coach): from a reviewed clip to the program it changes

Ruairi's review day (form, 6 Oct 2026): "Watch videos, analyse weaknesses and
then adjust program accordingly". Videos already lead the Roster (#47), but
neither the Review Queue nor Athlete View linked to the editor, and the clip
context left out the "Prescribed" line. No new writes, no schema change.

### What changes

- **Prescribed line.** `toClip` keeps `prescription_id` and `prescribed`;
  `ClipContext` renders `Prescribed: <snapshot>` under the logged line. It shows
  the set's stored snapshot (`5 reps · RPE 8`) and never recomputes it from the
  live line. A free set gets no line.
- **Adjust program** under each clip (with the set's line) and in Athlete View's
  "This block" (which used to say "No program yet" for everyone). Both go to
  `/coach/programs?athlete=<id>[&line=<id>]`, which:
  1. checks the coach's **active** link row first and reads nothing else
     without one ("Not one of your athletes" / "No longer linked");
  2. follows the line to its week and day if it is this athlete's, in one of
     their non-archived programs;
  3. else opens their current program (published, updated last), else lists
     their programs, else shows "No program for <name> yet";
  4. `router.replace`s to `/coach/programs/<id>?week=&day=&line=`. The editor
     opens that week in its own block, scrolls to the day and focuses the line.
- **Queue keeps its place.** [Fact] The queue holds position, Undo, the comment
  draft and two Realtime subscriptions in component state, and `cacheComponents`
  is off, so a same-tab navigation would reload it onto the oldest clip. The
  clip link opens a **new tab**: Cmd+W returns to the same clip with nothing
  re-read. The Enter-to-clear handler now ignores focused links. Athlete View
  links in the same tab, since it has no state that a re-read would lose.
- **Editor change kept small** (`program-editor.tsx`, about 25 lines): an
  optional `landing` prop, the block found from the landing week, a
  scroll-and-focus effect that runs once, and an `id` on each day section.
  Expect a trivial merge against the reference-lift branch.
- **Stale comments fixed:** the `clip-context.tsx` header ("no programs
  table") and the `roster-triggers.ts` "Nothing reads program tables yet"
  paragraph, plus the same claim in that file's other Order 19 comments and the
  Athlete View page header.

### Access

[Fact] `adjust-program.test.tsx` edits the URL to a never-linked athlete and to
a revoked one whose block the coach wrote (a coach can still read programs they
wrote after a revoke, per `docs/programs.md`). It asserts the refusal screen, no
program or line read, and no redirect. A `line` from another athlete's program
is ignored, and URL ids that are not valid row ids are dropped. The editor URL's
`week/day/line` only sets where it opens and grants nothing. Writes still go
through `/api/program`, which re-checks the link.

### For Joey

- `scripts/e2e-roster.mts:202` still checks "no block until the Program Editor
  exists". Not edited. [Inference] It should still pass, because the script
  writes no program for its fixture athlete, but the label is now stale.
- [Unverified] A new tab cold-loads the coach shell. Nobody has measured whether
  that fits the 2.5s budget on the beta instance.
- [Inference] When the coach focuses a queue-rail button and presses Enter, the
  window handler clears the clip instead of selecting it. This predates this
  PR, which leaves it alone.
- [SME to confirm] Should a clip with no traced line (logged freely) land on
  the current block, or should it say so first?

### Verified offline

`npm test` 134 files / 2096 tests, `npm run lint`, `npm run typecheck` all
clean. No `appwrite:*` or `e2e:*` scripts were run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
