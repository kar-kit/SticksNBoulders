## Suggested next-set loads carry a "Suggested" marker

Ruairi answered "Should the app suggest next-set weights straight to athletes?"
with "Yes - marked as a suggestion" (form answer, 6 Oct 2026). Set-targets have
been filled since b15ca3f, so suggestions now reach athletes; the only mark was
the note "suggested from RPE 7 @ 170", which says where the number came from,
not that it is an offer the athlete can overrule, and which vanished on the
first keystroke.

### What changed

**A "Suggested" chip on the prefilled load.** It sits on the load cell's top
border, a filled accent chip with its `on-accent` label (the pairing the palette
clears for small text). The cell is the same 48px button, still opens the pad
on one tap, and keeps its accessible name; the chip is its accessible
description. Nothing blocks logging: the confirm square logs the suggested load
as it stands. No spinner, toast or request, so it behaves identically offline.

**`PlannedRow.suggested`.** Row state, not derived from `note`, because `note`
also carries a backoff's provenance. Set by `rowAfter` for an engine suggestion
and by `prescribeNewRows` for a weight priced off today's top set; dropped when
a coach's prescribed load replaces it.

**Cleared the moment the athlete edits the load** (`applyPad`), together with
the note. Opening the pad is not an edit; changing reps or RPE leaves it. It
does not come back if the athlete types the suggested number in.

**Docs and comment.** `docs/suggestions.md` said no suggestion reached an
athlete yet; it now describes when one appears (set-targets), and the marker.
The `[SME to confirm]` on `DEFAULT_SUGGESTION_MODE` is now a [Fact]: Ruairi
confirmed `direct` on 6 Oct 2026.

### Not touched

`lib/strength/suggestion.ts`, the per-athlete `direct | held` switch
(`coach_athlete_links.suggestions_mode`) and its default. Held still shows no
suggestion and no marker.

### Decisions

- [Inference] A logged set is not marked. By then the number is what the athlete
  did; nothing about how a set was prefilled is stored.
- [Inference] The existing "suggested from RPE 7 @ 170" line stays beneath the
  row as provenance and clears with the marker.
- [Unverified] The chip's placement at 390x852 was reasoned from the grid
  (about 110px load column), not checked on a device. Eyeball it once on the
  phone.

### Verification

`lint` · `typecheck` · **2034 tests, 127 files**. New: marker appears, clears on
a load edit, survives a reps edit, absent when held, present offline from the
cached switch, absent on logged rows; `suggested` set and dropped in `plan` and
`session-plan`. No e2e or appwrite scripts run; no schema or write-path change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
