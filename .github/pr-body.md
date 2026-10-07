## feat: first-run coach/athlete choice, last-used landing, and profile pictures

Joey: *"A first-time setup that asks whether you are a coach or an athlete, and
remembers where to send you every time you sign up or sign in"*, and
*"profile pictures for both coaches and athletes."* Decision on the first:
**last-used wins**.

Two commits, reviewable separately.

### Why now

A brand-new coach has no links, and the root decided coach versus athlete from
links alone, so Ruairi's first sign-in would open on an athlete's Today with no
route to the roster or the invite code (the Me button also needed a link). And
an athlete who linked but never logged or opened Me had no `profiles` row, so
the coach saw "Unnamed athlete". The welcome screen writes the profile at
minute one.

### Commit 1: `feat(auth): first-run mode choice and last-used landing`

- **`/welcome`**, once: "How will you use Sticks N Boulders?" Coach / Athlete
  and a name pre-filled from the profile or account (`fallbackName`).
  Submitting writes the profile first, then the mode. A failed profile write
  saves no mode, so the question comes back. An existing profile is renamed
  only if the field was edited.
- **Mode lives in Appwrite account prefs**: `snb_mode` (`coach`/`athlete`) and
  `snb_chose_coach` (keeps the way back for a coach with zero athletes after
  they look at Athlete mode). No schema change. `updatePrefs` **replaces** the
  stored object (SDK 26.2 typings), so every write reads and merges first.
  Prefs arrive on the existing `account.get()`, so landing costs no request.
- **Landing table** (`landingFor`, `lib/auth/mode.ts`): mode wins; no mode +
  links = pre-existing coach, routed to the roster and saved silently; no mode
  + no links = `/welcome`; offline never sends anyone to `/welcome`. The mode
  is cached in the remembered-user record for offline cold starts.
- **Last-used**: the athlete layout and the coach layout record their side on
  mount, only on change, best effort, never from an offline session.
- **Google/Apple** now return to `/` instead of `/today`, which had skipped the
  root's decision entirely.
- **Way back to coach mode**: a "Coach mode" chip on every athlete screen and
  the Me button, for anyone with links or `snb_chose_coach`.
- **Bug fixed on the way**: `ensureMyProfile` never ensured the circle, and
  Appwrite refuses the profile's `team:` read from a session outside the team.
  The offline runner happened to ensure it first; Me did not, so a brand-new
  account opening Me got "Couldn't load your profile".
- Docs: new `docs/onboarding.md`; `lib/auth/role.ts` comment now says exactly
  what exists (no permission flag; a stored landing preference);
  `docs/invite-codes.md` "Why everyone is offered a code" rewritten.

### Commit 2: `feat(profile): profile pictures for coaches and athletes`

- **Schema v13** (additive): bucket `avatars` and nullable
  `profiles.avatar_file_id` (string 36, no index).
- **Permissions** (`avatarPermissions`): owner read/update/delete, owner's
  circle read. Never `read("users")`. Same audience as the profile row.
- **Coach to athlete**: the athlete is not in the coach's circle (why the
  coach's name already comes via `/api/link/coach`), so the coach's picture
  comes via `/api/link/coach/avatar`: athlete from the JWT, active link,
  authentic coach profile, file read with the API key. No parameter names a
  file or user.
- **Borrowed pictures**: ids are `<userId>_<8 chars>`; readers go through
  `avatarOf`, the helper refuses foreign ids. validate-row **keeps** such a row
  and logs why (deleting an honest profile over a cosmetic field is the wrong
  trade); squats are still deleted.
- **Client pipeline**: `createImageBitmap(..., { imageOrientation: "from-image" })`,
  centred square, 512px, WebP with JPEG fallback (Safari <17 returns PNG for
  WebP), 2MB cap. Replace = upload, repoint, delete old (best effort). Online
  only, plain error offline.
- **Fetching**: an `<img src>` at Appwrite carries no session (third-party
  cookie on Appwrite's origin; `<img>` cannot send the SDK's header), so bytes
  come through the SDK's own `client.call` into blob URLs. Unlike clips, no
  signed ticket: a picture is one small GET, not a range-streamed `<video>`.
  `fetchAthleteNames` now selects `avatar_file_id` and feeds a registry, so no
  extra profile reads.
- **UI**: `components/ui/avatar.tsx` (initials underneath, fixed size, lazy,
  alt = name) in the coach header, rail, roster rows, review-queue list and
  clip header, Athlete View, Me (Photo row), the athlete's COACH section, and
  an optional skippable photo step after `/welcome`.
- Orphan sweep, backups doc, audit rules and runner all learn the bucket.
  New `docs/avatars.md`.

### Deliberately not done

- No permission change anywhere: mode is a landing preference only.
- No crop UI; the square is always centred.
- Sex is still asked on Me, not in `/welcome` (`docs/profile.md` [SME to confirm]).
- validate-row does not delete a profile with a foreign avatar id (see above).
- No server-side image transform (`getFileView`, not `getFilePreview`).
- No new e2e script for avatars; existing e2e/audit scripts edited, **none run**.

### After merge (orchestrator)

1. `npm run appwrite:setup`. Expected plan, nothing else:
   - `create-column profiles.avatar_file_id` (string, 36, not required)
   - `create-bucket avatars` (fileSecurity, `create("users")`, 2,000,000 bytes,
     webp/jpg/jpeg, compression none, **encryption on**, antivirus off)
   Re-run to confirm "Schema already matches."
2. Optional: `npm run appwrite:functions` to redeploy validate-row. Only its
   log reason changed (keep/delete behaviour identical).
3. `npm run appwrite:audit` should now cover the `avatars` bucket (runner
   edited, not run).

### Tests

`npm test`: 2356 passed / 145 files (baseline 2232 / 138). `npm run lint` and
`npm run typecheck` clean. New: exhaustive landing table, garbage prefs,
prefs merge; a jsdom flow test crossing welcome → profile → prefs → landing →
shell switch with Appwrite faked at the network boundary (replace-semantics
prefs, team-stamp refusal); real-image pipeline test via sharp (EXIF-rotated
1200x600 → upright 512x512 WebP); replace/remove/rollback store tests; a
coach-sees-athlete-avatar cross test with a select-honouring fake.
Mutation-checked: 30 source mutations (13 on commit 1, 17 on commit 2), 27
caught first time. The three survivors each exposed a weak test, now
tightened and re-run caught: an untouched pre-fill renaming an existing
profile, a fake `listRows` that ignored `Query.select`, and a squat test whose
file id was outside the coach's namespace (so provenance was never exercised).

### Manual test list (real app)

1. **Brand-new coach** (email sign-up): lands on `/welcome`, name pre-filled;
   choose Coach, Continue, Skip photo → `/coach/roster` with the invite panel.
   Check Appwrite console: profile row exists with that name; user prefs show
   `snb_mode: coach`, `snb_chose_coach: true`.
2. **Brand-new athlete**: `/welcome` → Athlete → `/today`. No Coach mode chip.
3. **Existing account with links and no mode** (e.g. Ruairi today): sign in →
   roster directly, no welcome; prefs now `snb_mode: coach`.
4. **Existing athlete, no links, no mode**: sign in → `/welcome` once.
5. **Google sign-in**, new account: returns to `/` then `/welcome` (not `/today`).
6. **Last-used**: as a coach tap Athlete mode → sign out → sign in → `/today`.
   Tap the Coach mode chip → roster → sign out/in → roster.
7. **Coach with zero athletes** who taps Athlete mode: chip and Me button still
   offer Coach mode.
8. **Avatar upload** on Me with an iPhone **portrait HEIC** photo (iOS Safari
   and installed PWA): preview is upright and square; Save; reload; still there.
9. **Replace**: upload another; console shows only one file for that user in
   `avatars`. **Remove**: initials return, file gone.
10. **Desktop Chrome with a .heic file**: plain "couldn't be opened" message.
11. **Coach sees athlete avatar** in rail, roster row, review queue list and
    clip header, Athlete View header. **Athlete sees coach's avatar** on Me
    under COACH; after unlinking it disappears.
12. **Offline**: airplane mode, try to add a photo → plain offline message,
    rest of Me works.
13. **Offline cold start**: as a coach, sign in online, kill the app, go
    offline, reopen from the home screen → lands on the roster; as an athlete →
    Today.
14. **Welcome photo step**: add a photo there instead of skipping → lands home
    with the picture showing.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
