## FTP1-6 — Exercise library, typeahead and create-on-the-fly

**Notion:** [MVP Feature List — Order 6](https://app.notion.com/p/c1595d12346b47fd9939ea81cd33ab4d)
**Depends on:** #1–#6 (all merged)

Ruairi's complaint number two, answered directly. RTS made him hunt through a
tree for a lift he could have spelled in a second, so there is no tree, no
dropdown of the library, and no step between typing a name and having it.

### Scope

The component and the library behind it. **Not** the Log Session screen —
start/run/finish a session is Order 7, logging a set is Order 8, and most of
the Log Session blueprint belongs to those. This ends at a typeahead you can
use on `/design` and a seeded library behind it.

### Matching runs on the device, and that is not just about speed

Speed is the obvious argument. The one that settles it is **Order 9**: offline
logging is normal, not an error, so an athlete picking an exercise in a
basement gym with no signal must still get the list. That makes a local library
a requirement rather than an optimisation, so it is loaded whole, once, and
matched in memory.

Consequence worth stating: **`idx_name_search`, the fulltext index on `name`,
is now unused.** Left in place in case the coach's Program Editor outgrows this
and wants a server-side search, but nothing queries it today.

### How it matches

Exact, then prefix, then initials, then a word from the middle, then substring,
then a subsequence that forgives a typo:

| typed | finds |
| --- | --- |
| `squ` | Squat, before Front Squat — ties break on the shorter name |
| `rdl` | Romanian Deadlift |
| `cgbp` | Close Grip Bench Press |
| `bech press` | Bench Press |
| `split` | Bulgarian Split Squat |

Two rules came out of building it. A single letter no longer matches every name
merely *containing* it — `s` was matching Bench Press, which is the 400-item
dropdown rebuilt by accident. And `rdl` needed more than word initials:
Romanian Deadlift has two words, so its initials are `rd` and the L comes from
inside "deadlift". Lifters write RDL anyway.

Ranking is deterministic — no recency or frequency weighting, which would mean
a first result that moves under a thumb, and there is no set data to weight it
with until Order 8 anyway.

### The screenshot caught the flaw worth catching

Typing `rdl` offered **"Add rdl"** as a new exercise — a junk library row one
mis-tap away. A query that matched by its initials now never offers creation.

A typo still does. `bech press` might genuinely be this athlete's lift, the
right match sits directly above it, and being unable to add something is the
failure that sends a coach back to a spreadsheet.

**Joey's call, 14 Sep: creation stays available whatever you have typed, and
the row reads "Add custom exercise" rather than "Add bench"** — a command built
from half a typed word reads as a mistake. The typed name still shows
underneath it in quotes, because that row is one tap from a permanent entry in
the athlete's library and nothing should get there unseen.

Both states, captured at 390pt (`.shots/typeahead-match.png`,
`.shots/typeahead-create.png` — gitignored, so rendered here):

```
  EXERCISE TYPEAHEAD                EXERCISE TYPEAHEAD

  +----------------------------+    +----------------------------+
  | rdl                        |    | Zercher Squat              |
  +----------------------------+    +----------------------------+
  +----------------------------+    +----------------------------+
  | Romanian Deadlift          |    | | Add custom exercise NEW  |
  +----------------------------+    | | "Zercher Squat"          |
                                    +----------------------------+
                                     ^ accent rule marks a create

  an abbreviation offers no          creation is always available,
  "Add rdl"                          and always last
```

### Create-on-the-fly resolves before it writes

`idx_normalised` is a **key** index, not a unique one, so Appwrite would accept
a second "Barbell Row" quite happily — and that lift's history would then split
across two ids, half under each. The typed name is resolved against the loaded
library first, global rows preferred over a personal duplicate. That check is
what `normaliseExerciseName` was written for; it just did not exist until now.

### One component, two surfaces

Order 6's Pages are Log Session **and** Program Editor, so this is a full
combobox rather than a list of tappable rows. The athlete meets it at 390pt
with a thumb, so every option is a 52px target. Ruairi meets it at 1440 with
his hands on the keyboard, so arrows move (wrapping), Enter selects, Escape
dismisses without choosing anything, and `aria-activedescendant` tracks the
active option. Building one and retrofitting the other at Order 19 would mean
rewriting it.

### Also in this PR

- **`appwrite/documents/browser-writer.ts` — the first browser write path in
  the product.** Everything before this was reads and scripts. It lives inside
  `appwrite/documents/` because that is the only directory allowed near
  Appwrite's row mutators, so a component wanting to write has to come through
  the helper to reach it. Worth reviewing as helper code, not as typeahead
  plumbing: every later athlete-side write depends on it.
- **`npm run exercises:seed` — reconciles, never inserts blindly.** A global
  exercise is readable by everyone and writable by nobody, so once seeded,
  nothing in the app can fix a typo in one; re-running this is the only route.
  It creates what is missing, renames what changed, reports orphans and
  duplicates, and never deletes — a library row an athlete has logged sets
  against is referenced by `exercise_id` on every one of them.
- **`--fill` on `scripts/shot.mjs`**, so a component whose interesting state
  only exists after someone types can be photographed in that state.

### Judgment calls, stated rather than buried

- **Not the TanStack Query PR.** It is the agreed stack, but the cache this
  list needs is a *persistent* one and that arrives with IndexedDB at Order 9.
  An in-memory cache that empties on reload is the wrong property for a PWA an
  athlete reopens between sets. The provider follows the existing
  `SessionProvider` pattern instead.
- **The provider is not mounted in the athlete shell yet.** Nothing consumes it
  until Order 7, and mounting it now would mean an extra request on every
  athlete page load for no benefit. Order 7 mounts it.
- **The 54 seed exercises are `[Inference]`.** Nobody specified the contents —
  powerlifting staples and the variations a coach actually programmes,
  deliberately not a bodybuilding database. **[SME to confirm]** Ruairi should
  cut and add before the beta.

### Decided while reviewing this: a variation is its own exercise

Joey, 14 Sep. `3-0-0 Tempo Bench Press` is its own library row, **not**
`Bench Press` carrying a tempo field, and no modifier system gets built for
tempo, pauses or grip.

A tempo bench max is not a bench max, so folding variations into a base lift
would make one reference max stand in for lifts that move different weights.
`Bench Press` is itself ambiguous — competition paused to one coach,
touch-and-go to another — and a program can legitimately contain both plus a
tempo variant. And coaches use whatever seconds they like, so any fixed set of
modifier fields would be wrong for somebody inside a week.

The cost is accepted: the same lift can exist under more than one spelling. The
typeahead is what keeps that rare — differently punctuated notation converges
before anyone is offered a second row:

```
  "tempo"                  -> every tempo variant
  "3-0-0", "3 0 0 tempo"   -> 3-0-0 Tempo Bench Press
  "300 tempo bench press"  -> 3-0-0 Tempo Bench Press   (loose match)
  "320", "023"             -> 3-2-0 Tempo Bench Press, 0-2-3 Tempo Squat
  "3-1-0 tempo bench press"-> nothing, offers to add it
```

Recorded in `lib/exercises/seed.ts` and on Notion Orders 17 and 18, since that
is where someone would otherwise build the modifier system. It settles shape
for Order 12 (rollups per exercise), Order 17 (a max per variation) and Order
18 (no tempo fields on a prescription).

### Handoff to Order 7

`resolveOrCreateExercise` returns `{ exercise, created }` and the provider has
`remember`, but nothing joins them yet — a freshly created exercise will not
appear in the library until a reload. Nothing calls the resolver in this PR, so
there is no bug here today; it is the one seam Order 7 has to close when it
mounts the provider and wires the logger to it.

### Verification

50 new tests, 567 total. Seeded against the live instance and re-run to confirm
it is idempotent ("nothing to do: all 54 seed entries are present and
correct"). `npm run appwrite:probe` still 19/19, which is what proves the
seeded rows are readable by every signed-in user rather than assumed to be.
`npm run perf:check` unchanged — interactive at 388ms on Fast 4G.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
