## FTP1-3 — Sign in: email + password, Google, Apple

**Notion:** https://app.notion.com/3da64699b43c8128b527d64ec55746aa
**Depends on:** #1, #2 (both merged)

### What was built

The sign-in screen from `01 — Sign In`, built to the design frame: provider
buttons above the fold, email and password below the divider, create-account
toggled on the same screen, and every state the blueprint names — wrong
password, offline, already-signed-in, and the account-created-with-Google trap.

Email and password work end to end against the live instance. Google is wired
and configured. Apple is built and hidden behind a flag.

### Two [Unverified] items from the blueprint, now resolved

**1. How Appwrite reconciles an OAuth identity and a password identity.**
Probed against the running instance. A wrong password, an account created
through Google, and an email nobody has registered **all return an identical
`401 user_invalid_credentials`.** The client cannot tell them apart, so the
blueprint's "You signed up with Google" state is not implementable client-side
at all.

That also surfaced a contradiction in the blueprint itself: it asks for *"do
not reveal whether the email exists"* **and** *"say plainly: you signed up with
Google"*. The second is the first. Joey chose to resolve it by hinting only
after a password attempt has already failed — so `/api/auth/method-hint` exists,
and is deliberately stingy:

- Answers **only** for accounts that have no password. Never confirms an
  unknown address; never confirms one that has a password set.
- Rate-limited twice: 10/min per caller, 5/10min per address.
- Rejects malformed input before spending any rate-limit budget, so junk cannot
  lock a real caller out.
- The limiter is in-memory, which holds for one self-hosted instance. **A
  multi-instance deploy needs shared state.**

**2. Whether Apple sign-in is mandatory.** It is not. App Store Review
Guideline 4.8 applies to store-distributed apps; this is a PWA with no store
submission. Apple also returns `412` on the instance — not configured, and
enabling it needs an Apple Developer account (£99/yr) plus a Services ID. Built
to the design, hidden behind `NEXT_PUBLIC_APPWRITE_APPLE_ENABLED`, default off,
so the beta never shows a button that fails. One env var flips it on.

### CLAUDE.md corrected

Constraint 2 said **"No passwords. Magic link only. No password field exists in
this product."** Three Notion sources contradict it — `00 — Conventions`,
Order 3 with dated provenance, and Order 3.5 existing at all — and this PR
implements the contradiction. The constraint is rewritten to match, and the
"verify Appwrite passkey support" item is marked resolved.

**This is the one change in this PR that is Joey's call to reject rather than
mine to make.** It is a separate commit so it can be dropped on its own.

### Decisions not specified anywhere

- **`.env.local` is now the only env file.** `APPWRITE_API_KEY` lived in
  `.local.env`, which Next.js does not load — see the bugs below.
- **`/sign-in/forgot` exists and says reset is not set up yet**, rather than
  404ing behind a link the design puts on screen. That is the true state:
  `createRecovery` currently fails because no Web platform is registered.
  FTP1-3.5 replaces it.
- **`/today` is a placeholder** showing who is signed in with a sign-out button.
  Sign-in needed a destination; Order 7 builds the real screen.

### Tests

53 new, 400 total. Plus `npm run e2e:auth` — 14 assertions driving a real
browser against the live Appwrite, because the half that matters here is the
half mocking cannot reach:

```
creating an account signs you straight in / Today shows who is signed in
sign-in is skipped while a session exists / signing out returns to sign-in
wrong password: says so inline / offers a reset link / reveals nothing
right password signs in
an account with no password gets no reset link
hint: silent for unknown / silent when a password exists / answers for
      passwordless / ignores junk / rate-limits a flood
```

Unit tests cover the error mapping, the rate limiter's sliding window, the hint
policy's refusals, provider gating, and every form state. Appwrite is mocked at
the session-module boundary, not re-implemented.

### Bugs found and fixed

1. **`APPWRITE_API_KEY` was invisible to Next.js.** It lived in `.local.env`;
   Next loads `.env.local`. The hint route threw on every request — and my
   catch-all turned that into `{"hint":"none"}`, which is **indistinguishable
   from working correctly**. The swallow was the worse bug: it now logs
   server-side while still staying silent to the caller.
2. **The unknown-provider case offered a dead-end reset.** When the server knows
   an account has no password but cannot name the provider, the UI fell back to
   the generic message — which offers "Forgot your password?" for an account
   with no password to reset. That is the exact dead end this feature exists to
   prevent. Now its own state. Found by the e2e, invisible to the unit tests.
3. **My own guard test was wrong.** It failed on any mention of
   `APPWRITE_API_KEY` under `app/`, including a comment in a server-only route
   handler. Route handlers never reach the browser; the real leak is a
   `NEXT_PUBLIC_` prefix. Replaced with three accurate rules: no secret ever
   gets a `NEXT_PUBLIC_` prefix, the key is read only in server-only paths, and
   no client component imports the admin client.
4. **`resolveMethodHint` accepted `"@"` as an email** and would have spent an
   admin-key lookup on it.
5. **`scripts/shot.mjs` failed every signed-out page.** The browser logs a
   console error for any 401, and `account.get()` returning 401 when nobody is
   signed in is the app working. Expected auth statuses no longer fail a shot.

### Blocked on you

- **Register a Web platform** (`localhost`, and the eventual host) in the
  Appwrite console. Needed for password reset redirects at FTP1-3.5. My API key
  lacks `platforms.read`/`projects.read`, so this is a console action.
- **SMTP**, also for FTP1-3.5.
- **Apple**, if you want it: Developer account + Services ID, then flip the env
  var. No rework either way.

### Screenshot

`.shots/sign-in.png` — 390pt. Logo, Google button with the real four-colour
mark, divider, labelled fields with the eye toggle, Forgot, Sign in, Create
account. Matches the `01a` frame.
