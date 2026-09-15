## Order 17 — Reference maxes

A percentage prescription is meaningless until something says what it is a
percentage **of**. This is the table Order 18 writes against.

### A table with effective dates, not a number on the profile

The ticket is explicit about this and the reason is worth restating: if a
prescription says 80% and the max is one mutable field, then every block ever
written silently re-prices itself the moment that field moves. An e1RM ticking
up in October changes what August's session meant.

So entries are append-only, each carries the date it takes effect from, and
asking for the current max is asking a question with a date in it. Entries
dated in the future stay invisible until they arrive — which is what lets a
coach set next block's numbers in advance without disturbing this week's.
There is no update path; a new number is a new row, and deleting is the only
edit.

### Three kinds, two stored

| Kind | Lives in | Meaning |
| --- | --- | --- |
| `tested` | `reference_maxes` | An actual max attempt |
| `training` | `reference_maxes` | What percentages are calculated against — routinely not the tested max |
| `estimated` | `stats_rollups` | Rolling e1RM from logged work |

**Estimated is derived, never stored here.** `best_e1rm_kg` already sits in the
rollups and the rebuild script regenerates it from raw sets; a second copy would
leave that script repairing half the data. `STORED_KINDS` has a test asserting
it holds exactly two values, so a third cannot be added quietly.

### The permissions took two attempts, and the second is the point

This table inverts the product's usual rule. Everywhere else the athlete writes
and the coach only reads, because logged work is the athlete's — but a training
max is programming input, and setting it *is* the coaching. The coach is the
author.

That made a client-side write look right. It was built that way, and the
permission probe refused it: Appwrite will not let a caller stamp a role they
do not hold, so a coach can never grant the athlete a read.

Fixing that surfaced the real problem, which no permission shape solves.
**Appwrite constrains who may read a row. It cannot constrain what a row says.**
`athlete_id` is data, not a permission, and there is no rule of the form
"create only rows where this field equals your own id". With any table-level
create, a signed-in stranger could write a row carrying somebody else's
`athlete_id`, stamp it with a role everybody holds, and that invented number
becomes what the athlete's percentages resolve against. A wrong number on a bar.

It is `invite_codes` again: a code someone can mint for themselves is a code
they can mint naming somebody else as the coach.

So `reference_maxes` is **server-only**. Table permissions `[]`, row
permissions identical to a rollup, writes through `app/api/reference-max` with
the API key behind `mayWriteFor` — the athlete, or a coach with an **active row
in `coach_athlete_links`**. The link row is checked rather than circle
membership, so a membership left behind by a half-failed revoke is never
mistaken for an authorisation.

### Probe: 36/36

Six new checks. The ones worth naming:

- neither the coach **nor the athlete** can create a row from a browser;
- a stranger cannot forge one carrying another athlete's id and a role everyone holds;
- nothing can be edited in place;
- a revoked coach loses **both read and write**, without anything re-stamping a row.

That last one falls out of the circle design for free and is the case nobody
would think to test.

### Two things caught in review, both of which changed what ships

- **Panel order.** `buildMaxRows` sorted heaviest-first. The blueprint reads
  Squat, Bench, Deadlift — competition order — and the seeded library is
  already in that order, so rows now pass through in library order. Sorting by
  weight would have put most lifters' deadlift first and diverged from the spec
  quietly.
- **Pagination pointed the wrong way.** The read was `orderAsc("$id")` capped at
  200. Appwrite ids are time-prefixed, so that kept the *oldest* 200 and
  discarded the newest: past the cap the panel would freeze on stale numbers
  with no error, taking every percentage resolved against them with it. Now
  `orderDesc`.

### Scope

The panel is **read-only**. The blueprint puts an `[ edit / set training max ]`
control in it; that belongs with the rest of Athlete View at Order 25, and
building it now means building it against a screen that does not exist.

The write path underneath is complete and tested — route, admin module, client
store — because the panel and Order 18 are both inert without a way to put a
number in. **No e2e script**: there is no UI to drive, so unit tests on the
admin module plus the probe is the honest coverage.

### [SME to confirm]

A max is held **per exercise, not per base lift** — a tempo bench and a
competition bench are different numbers. Whether a percentage *on* a variation
may point at the base lift's max is still open with Ruairi. It is a property of
a prescription, so it belongs to Order 18 and is deliberately not modelled here.

### Verification

`typecheck` · `lint` · **974 tests** · `build` · `appwrite:probe` **36/36** ·
`perf:check` within budget (interactive 359ms Fast 4G).

Schema **v4**, applied live. Also renames a schema test whose title named the
phases it covered and had gone stale twice in three tickets, and adds an
assertion that a server-only table carries no table-level create — the exact
drift that bit mid-ticket.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
