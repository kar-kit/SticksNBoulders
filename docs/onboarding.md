# Onboarding: coach or athlete, and last-used landing

Joey, 7 Oct 2026: *"A first-time setup that asks whether you are a coach or an
athlete, and remembers where to send you every time you sign up or sign in."*

## The bug this closes

The root (`app/landing.tsx`) decided coach versus athlete from
`coach_athlete_links` alone. A brand-new coach has no links, so Ruairi's first
sign-in would have opened on an athlete's Today. The roster and the invite code
were reachable only by a "Coach mode" button on Me, and that button also needed
a link to appear. A coach with no athletes had no route to the one screen that
gets them athletes.

Separately, an athlete who linked to a coach but never logged anything or
opened Me had no `profiles` row, so the coach saw "Unnamed athlete". The welcome
screen writes the profile at minute one, which fixes that at the source.

## What is stored, and what it is not

Two keys in **Appwrite account prefs**, read and written in `lib/auth/mode.ts`:

| Key | Meaning |
| --- | --- |
| `snb_mode` | `"coach"` or `"athlete"`: the side they last used |
| `snb_chose_coach` | `true` once they have chosen or used coach mode |

**It is a landing preference and grants nothing.** Access still comes from
`coach_athlete_links` and the circle teams, unchanged. Nothing in
`appwrite/documents`, no query and no permission reads either key. Anyone may
set their own mode to `"coach"`; what they get is an empty roster and an invite
code.

Prefs rather than a column on `profiles`, for two reasons. Prefs belong to the
account and only its own session writes them, so there is no provenance
question (a profile column would need the squat and forgery reasoning in
`docs/profile.md`). And a profile is readable by the athlete's circle, so a
column there would show a coach somebody's landing preference for no reason.

`account.updatePrefs` **replaces** the stored object (SDK 26.2: *"stored as is,
and replaces any previous value"*). `saveMode` therefore reads prefs fresh and
merges before writing. Two writes racing can still lose one; the next shell
mount rewrites it, so the loss lasts one navigation.

Prefs arrive on the `account.get()` the session already makes, so landing costs
no extra request.

## The landing table

`landingFor` in `lib/auth/mode.ts`, tested row by row:

| Mode | Links | Offline | Goes to |
| --- | --- | --- | --- |
| coach | any | any | `/coach/roster` |
| athlete | any | any | `/today` |
| none | yes | no | `/coach/roster`, and `coach` is saved silently |
| none | yes | yes | `/coach/roster`, nothing saved |
| none | no | no | `/welcome` |
| none | no | yes | `/today` |

The no-mode rows are the migration. An account from before this change that
already has athletes is a coach by every measure the app had, so it is not
asked. An offline account with no answer goes to Today: the form needs the
server, and Today works without it.

Every sign-in route goes through the root. Google and Apple used to return to
`/today`, which skipped this decision; they now return to `/`.

## Last-used wins

Joey's call: **the destination is wherever they last were.** A coach who taps
Athlete mode opens on Today next time.

The athlete layout (`AthleteProviders`) and the coach layout
(`CoachLayoutShell`) each record their side on mount, so a deep link counts the
same as the toggle. They write only on a change, and never from a session
recalled offline. A failed write is swallowed: nothing about navigating waits on
it.

That rule creates one trap, and `snb_chose_coach` exists to close it. A coach
with no athletes who looks at Athlete mode now has mode `"athlete"` and no
links, so a button gated on either would vanish. The way back is shown for
anyone with links **or** `snb_chose_coach`: a "Coach mode" chip at the top of
every athlete screen, and the button on Me.

## The welcome screen

`/welcome`, once. *"How will you use Sticks N Boulders?"* Coach or Athlete, and
a name pre-filled from the profile if one exists, else from the account
(`fallbackName`). Submitting writes the profile first and the mode second
(`completeWelcome`), so a failed profile write leaves no mode behind and the
question is asked again. An existing profile is renamed only if the field was
edited.

Sex is not asked here. It stays on Me, where its reason is stated (see
`docs/profile.md`).

## Fixed on the way past

`ensureMyProfile` could not create a profile for an account with no circle
team. The row carries a read for the circle, and Appwrite refuses a `team:` role
from a session that is not in the team. The offline runner happened to ensure
the circle first; the Me screen did not, so a brand-new account opening Me got
"Couldn't load your profile". Both profile writers now ensure the circle
themselves.

## Signing out

`forgetUser` clears the device's cached copy and nothing else. The mode lives on
the account, so signing back in, on any device, restores it.

## Files

| File | What it holds |
| --- | --- |
| `lib/auth/mode.ts` | Pure: the prefs keys, parsing, merge, the landing table, last-used |
| `lib/auth/mode-store.ts` | `saveMode`: read, merge, write |
| `lib/auth/welcome.ts`, `welcome-store.ts` | Reading the form; what submitting writes |
| `lib/auth/session-context.tsx` | Mode on the session, `recordMode`, `useRecordMode` |
| `app/welcome/` | The screen, and the flow test that crosses it |
