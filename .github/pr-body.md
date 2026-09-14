## FTP1-8 — Log a set: weight, reps, RPE, warm-up flag

**Notion:** [MVP Feature List — Order 8](https://app.notion.com/p/c1595d12346b47fd9939ea81cd33ab4d)
**Depends on:** #1–#8 (all merged)

The screen this product lives or dies on. An athlete touches the set row twenty
to forty times a session, one-handed, breathing hard. **No keyboard ever
appears** — the number pad is the only way a number gets into this product.

```
  Squat                    Undo last set          ┌─────────────────────┐
  #   KG      REPS   RPE                          │ REPS            5   │
  W   60      5      —      ✓                     │  1    2    3        │
  1   142.5   5      8      ✓                     │  4    5    6        │
 ┌────────────────────────────────┐               │  7    8    9        │
 │2   142.5   5     RPE    [ ✓ ]  │  ← prefilled  │  .    0    ⌫        │
 └────────────────────────────────┘    one tap    │ Warm-up  Done  RPE  │
                                                  └─────────────────────┘
```

### The number pad is a state machine, not an input

The behaviour people expect from a calculator — the existing value is selected,
so the first digit **replaces** it — is not what a text field does. `142.5`
quietly becoming `142.57` is a wrong number in someone's training log. Loads
take two decimals (finer than any plate), reps refuse a decimal point entirely,
a leading zero is never kept, and backspace edits rather than clears.

### The bug the tests caught, in the rule that matters most

**Prefill rule 3 — repeat the previous set — silently did nothing.** `draftFor`
read the set list through a closure that hadn't seen the optimistic append yet,
so the row after a logged set came up empty. Straight sets are the norm and the
blueprint calls this *the* rule that must cost one tap. It cost four. The
confirm path now builds the next row from the set it just logged rather than
from state it cannot see yet.

### Decisions

**The warm-up toggle is in the pad sheet, not behind a long press.** The
component spec's own objection — hidden gestures on the most-used screen are a
support burden — applies to the flag as much as anything. Toggling to warm-up
clears any RPE already entered: warm-ups never ask, and are excluded from PRs
and rollups, so one carrying an RPE is a value nothing will ever read.

**Neither the warm-up flag nor the RPE carries into the next row.** A missed
flag counts a warm-up toward tonnage, which is minor. A stuck one hides real
work from PRs and the rollups, which is the failure nobody notices.

**Set writes ensure the circle, not just session start.** A session resumed on a
fresh page load never runs the start path, so the memoised promise is cold and
the first set of the day would 401 — Order 7's bug in a window narrow enough to
be much harder to spot. There's a regression test for resume-then-log.

**`client_set_id` is generated once per row and reused on retry.** A 409 from
its unique index is success, not failure: the first attempt landed and the
response was lost on the way back. Mid-set on gym wifi is exactly where that
fires.

**Undo last set is here; swipe-to-delete and long-press are not.** Both are in
the component spec and both are deferred — but a mis-logged set with *no* way to
remove it until History exists is a worse first session than a visible Undo, and
`deleteSet` was already in the helper.

**Optimistic, and nothing more.** The row appears logged immediately because
instant is the feature, and comes back off if the write fails rather than
sitting there looking logged. No retry loop, no queue, no persistence — Order 9
is the write-ahead queue, and half of one built here would only have to be
unpicked.

### Scope

Prefill rules 1, 2 and 4 are not wired: they need a prescription, the RPE engine
and a query into the last session — Orders 22, 27 and 13. `resolvePrefill`
already resolves each field independently, so passing only rule 3 is a partial
call rather than a stub.

Also not here: `e1rm_kg` on the set (Order 11 — the RPE→%1RM chart is still
`[Unverified]` and writing a number from an unverified table into someone's
training log is the one thing worth waiting for), the rest timer (Order 10),
video (Order 29), and the rounding/pounds question the component spec leaves
open — **[SME to confirm]** with Ruairi, default kg, no toggle built.

### Verification

34 new tests, 651 total. `npm run e2e:session` extended to **27 assertions**,
driving the real pad in a real browser:

```
Logging sets        a warm-up logs and shows as W
                    the next row prefills from the set just logged
                    three sets reached Appwrite / one flagged warm-up / RPE stored
After a reload      the warm-up came back, and both working sets, numbered
                    no fourth set was written by the reload
Finishing           set_count counts working sets only        → 2
                    tonnage excludes the warm-up              → 1400

27/27 passed. Athlete and sessions removed.
```

Those last two are the assertions FTP1-7 couldn't make, because no sets existed
to disagree about.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
