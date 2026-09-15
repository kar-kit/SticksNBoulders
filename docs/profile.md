# Profile: name, sex, units

Order 35. Small on the surface, and it fixes something larger underneath.

## The bug this ticket actually closes

**`createProfile` existed since Order 2 and was never called from anywhere.**

`fetchAthleteNames` reads the `profiles` table. So every athlete was nameless to
their coach: the coach's rail was empty, and `buildQueue` fell back to "Unnamed
athlete" for every clip in the Review Queue. The names looked like a display
problem and were a missing write.

`ensureMyProfile` is the fix, and it runs in two places:

- **`runOp`**, beside `ensureMyCircle` — the moment an athlete first writes
  something a coach will read. A set arriving from nobody is the state this
  prevents. Deliberately not awaited into the failure path: a profile that
  cannot be written must never stop a set from being logged.
- **The Me screen**, so opening Profile & Settings creates one for an account
  that has never logged anything.

Idempotent and memoised per page load, the same shape as `ensureMyCircle`. It is
seeded from the Appwrite account rather than from a form, so existing accounts
and Google sign-ins both get a row without anything standing between an athlete
and their first session.

## No server route, and why that is safe here

Every other owned table either goes through a route (`reference_maxes`,
`coach_athlete_links`) or was argued into client-writability (`set_reviews`,
`set_comments`). Profiles need neither argument:

**The row id IS the user id, and every permission on it names the owner.** So
Appwrite refuses a profile stamped for somebody else — the same stamping rule
that stopped a coach granting an athlete's read at Order 17, working in our
favour. The forgery that forced reference maxes onto the server does not apply,
because there the forgeable part was a field the row merely *claimed*, and here
it is the row's own identity, which Appwrite polices.

Asserted rather than assumed: `npm run e2e:profile` tries to create a profile
under another user's id and expects to be refused.

## Sex: required by the blueprint, nullable in the schema

These genuinely conflict, and the conflict is resolved in the product rather
than in the column.

> **Blueprint:** "Sex is required, not optional, because the DOTS coefficients
> differ and there is no sensible default."
>
> **Schema:** `{ key: "sex", ... required: false }` — "Nullable: collected at
> onboarding, and an athlete may decline."

The column stays nullable. Making it required would refuse every profile
`ensureMyProfile` backfills onto an existing account — turning a missing number
into a missing athlete — and `planSchema` correctly refuses a
nullable-to-required change as a `manual-column-change` anyway.

So: **storage permits the absence, the product asks anyway, and nothing
downstream guesses.** `needsSex` is deliberately not the same predicate as
`sex === null`; the Me screen shows an unanswered sex as a question with its
reason attached, and `computeDots` takes a non-nullable `Sex`, so a missing
answer cannot reach a coefficient set. DOTS renders nothing rather than picking
one of the two formulas.

**[SME to confirm]** — the blueprint wants this asked during onboarding, not on
the settings screen. The onboarding flow is its own blueprint page and not this
ticket, so today an athlete who never opens Profile & Settings has no DOTS and
is not told why. Worth deciding before the beta whether it belongs in the
sign-up flow.

## The rest of the screen

Only two of the three fields are ordinary. Name is what a coach sees, trimmed
and whitespace-collapsed so a rail never shows `Joey    Pang`, and capped at the
column's 64. Units are a **display preference only** — everything is stored in
kilograms, so switching never changes a logged number, and the screen says so.

Writes are optimistic and roll back on failure. A settings screen that lags
feels broken; a settings screen that claims something the server does not hold
is worse, and here a wrong sex is a wrong DOTS score later.

`fallbackName` never surfaces a raw id or a full email address: account name,
then the local part of the email, then the word "Athlete". A coach's rail
showing a hex string is bad; showing somebody's contact details to a third party
is worse.

## A latent bug fixed on the way past

`forgetCircle` has been exported since Order 9 and was never called. Both memos
are per page load and keyed to nobody, so on a shared phone the next person to
sign in would inherit whatever was cached for the last. `signOut` now clears
both — `forgetProfile` would have had the same bug, and it is worse because a
profile carries a name.

## What is not here

The blueprint's Profile page lists five features. **15** (invite code) and **16**
(redeem) already shipped. **Bodyweight** is Order 36's row. **The load-suggestion
toggle is Order 28 and is blocked** — the blueprint marks it `[SME to confirm]`
because it is a coaching philosophy question, not a product decision. **CSV
export** is Order 39. The coach-side **BILLING** section waits for something to
bill.

## Still yours to do

The ticket asks for something that is not code: *"Collect the real values from
Ruairi and the first athletes before the beta."* Sex and units are per-person
and nobody can fill them in for somebody else.

## Verified against the instance

`npm run e2e:profile` — 8 checks: an athlete creating their own profile with no
server route, the backfill case with no sex, **the coach read that makes the
rail work**, a stranger seeing nothing, the athlete answering later, the coach
being unable to edit it, the cross-user forgery being refused, and an unlinked
coach losing the name with everything else.

## Files

| File | What it holds |
| --- | --- |
| `lib/profile/profile.ts` | Pure: the two option sets, name rules, `needsSex`, fallbacks |
| `lib/profile/profile-store.ts` | `ensureMyProfile`, reads, saves |
| `components/profile/training-settings.tsx` | The TRAINING section |
| `scripts/e2e-profile.mts` | The permission claims, live |
