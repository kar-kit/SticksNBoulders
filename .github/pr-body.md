## Order 35 — Profile: name, sex, units

Picked next because it unblocks the most: sex feeds the DOTS coefficients, so
**Order 36 (bodyweight) and Order 37 (DOTS) both sit behind it.**

The ticket reads "name, sex, units". The useful part is underneath it.

### ⚠️ The bug this actually closes

**`createProfile` has existed since Order 2 and was never called from anywhere.**

`fetchAthleteNames` reads the `profiles` table — so every athlete has been
nameless to their coach this whole time. An empty rail, and every clip in the
Review Queue falling back to "Unnamed athlete". It looked like a display problem
and was a missing write.

`ensureMyProfile` runs in two places:

- **`runOp`**, beside `ensureMyCircle` — the moment an athlete first writes
  something a coach will read. Deliberately *not* awaited into the failure path:
  a profile that cannot be written must never stop a set from being logged.
- **The Me screen**, so an account that has logged nothing still gets a row.

Idempotent, memoised, seeded from the Appwrite account rather than a form — so
existing accounts and Google sign-ins both get one without a form standing
between an athlete and their first session.

### No server route, and why that's safe here

Every other owned table either goes through a route or had to be argued into
client-writability. Profiles need neither argument: **the row id IS the user id,
and every permission on it names the owner**, so Appwrite refuses a profile
stamped for anybody else — the Order 17 stamping rule working in our favour for
once.

The forgery that forced `reference_maxes` onto the server needed a field the row
merely *claimed*. Here the claim is the row's own identity, which Appwrite
polices. The e2e tries the cross-user forgery and expects to be refused.

### Sex: the blueprint and the schema genuinely disagree

> **Blueprint:** "Sex is required, not optional, because the DOTS coefficients
> differ and there is no sensible default."
>
> **Schema:** `required: false` — "Nullable: collected at onboarding, and an
> athlete may decline."

The column stays nullable and the product asks anyway. Making it required would
refuse every profile backfilled onto an existing account — turning a missing
number into a missing athlete — and `planSchema` refuses that migration as a
`manual-column-change` for the same reason.

So `needsSex` is deliberately *not* `sex === null`; the screen shows an
unanswered sex as a question with its reason attached, and `computeDots` takes a
non-nullable `Sex`, so a missing answer cannot reach a coefficient set. **DOTS
renders nothing rather than picking one of the two formulas.**

**[SME to confirm]** — the blueprint wants this asked at *onboarding*, not in
settings. The onboarding flow is its own blueprint page and not this ticket, so
today an athlete who never opens Profile & Settings has no DOTS and isn't told
why. Worth deciding before the beta.

### The rest

Name is trimmed and whitespace-collapsed, so a rail never shows `Joey    Pang`.
`fallbackName` never surfaces a raw id or a full email address — account name,
then the local part of the email, then "Athlete". A hex string in a coach's rail
is bad; somebody's contact details in front of a third party is worse.

Units are **display only**. Everything is stored in kilograms, switching never
changes a logged number, and the screen says so rather than leaving someone to
wonder whether their history just moved.

Writes are optimistic and roll back on failure — a settings screen that claims
something the server doesn't hold is worse than one that lags, and here a wrong
sex is a wrong DOTS score later.

### A latent bug fixed on the way past

**`forgetCircle` has been exported since Order 9 and never called.** Both memos
are per page load and keyed to nobody, so on a shared phone the next person to
sign in would inherit whatever was cached for the last. `signOut` clears both
now; `forgetProfile` would have had the same bug, and it's worse because a
profile carries a name.

### Not in scope

The blueprint's Profile page lists five features. **15** and **16** already
shipped. **Bodyweight** is Order 36's row. **The suggestion toggle is Order 28
and is blocked** — the blueprint marks it `[SME to confirm]` because it's a
coaching philosophy question, not a product one. **CSV export** is Order 39. The
coach-side **BILLING** section waits for something to bill.

### Still yours to do

The ticket asks for something that isn't code: *"Collect the real values from
Ruairi and the first athletes before the beta."* Sex and units are per-person
and nobody can fill them in for somebody else.

### Verification

`typecheck` · `lint` · **1188 tests, 75 files** · `build` · `perf:check` inside
budget · `appwrite:probe` 42/42 · no schema change.

Live against the instance:

- `npm run e2e:profile` — **8/8**: an athlete creating their own profile with no
  server route, the backfill case with no sex, **the coach read that makes the
  rail work**, a stranger seeing nothing, answering sex later, the coach unable
  to edit it, the cross-user forgery refused, and an unlinked coach losing the
  name with everything else.
- `npm run e2e:review` — 21/21, unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
