## FTP1-3.5 — Password reset and account recovery

**Notion:** https://app.notion.com/3da64699b43c81968d3ce635b01ff18b
**Depends on:** #1, #2, #3 (all merged)

### What was built

All three frames from `01c` — request a link, the confirmation, and choosing a
new password from the emailed link — plus two states the design does not draw
but the flow needs: a link with no token, and a link that has been used or has
expired.

- `/sign-in/forgot` — request, then a confirmation with a 60-second resend
  cooldown that counts down.
- `/sign-in/reset` — new password and confirm, then signed in.
- The stub that shipped in #3 saying reset was not set up yet is gone.

### The rule that shapes the whole flow

The confirmation says *"If joey@example.com has an account, a reset link is on
its way."* It means it. **The result of `createRecovery` is never read.**

That is not caution for its own sake — Appwrite may well answer differently for
an address with no account, and a screen that branches on the outcome leaks
exactly what the sign-in screen goes to some trouble to hide. Not reading it is
the only version that cannot leak by accident, and it is tested: the
confirmation renders identically whether the call succeeds, fails, or returns
`user_not_found`.

There is a live proof of this in the PR right now. SMTP is not enabled on the
instance yet, so `createRecovery` currently returns `503`. **The confirmation
still appears, unchanged** — that assertion is in the e2e run below.

### Decisions not specified

- **The email is carried from one screen to the other.** Appwrite's docs say
  the recovery link carries the address in the query string; the SDK documents
  only `userId` and `secret`, and I cannot confirm which is true without a
  delivered email. So the reset screen takes the query param if present, falls
  back to `sessionStorage` stashed when the link was requested, and falls back
  again to sending the athlete to sign-in. All three paths work; only the copy
  and the auto-sign-in differ. Marked `[Unverified]` in the code and worth
  deleting the fallback once a real email is seen.
- **A used or expired link changes the screen** rather than showing a message.
  Appwrite reports both the same way, and neither is something a sentence under
  a field can fix — the answer is a fresh link, so that is what the screen
  offers.
- **Being offline is not treated as a spent link.** The link is still good;
  telling someone to request a new one would waste the one they have.
- **No password composition rules.** "At least 8 characters. Nothing else
  required", straight from the design. Rules demanding a symbol push people to
  weaker passwords they write down.
- **Validation runs before the request**, so nobody is told a rule after the
  fact — and a too-short password is reported before a mismatch, rather than
  two errors in sequence.

### Tests

24 new, 457 total, plus the e2e extended to 23 assertions against the live
instance:

```
Password reset
  PASS  the Forgot link reaches the reset screen
  PASS  it says up front that the link expires
  PASS  the send button is inert until the address looks like one
  PASS  and active once it does
  PASS  the confirmation appears whatever the server answered
  PASS  it stays conditional about whether the account exists
  PASS  resending is on a cooldown
Reset link states
  PASS  a link with no token says it is incomplete
  PASS  a token Appwrite rejects is reported as expired, with a way to get another
```

That last one is a genuine round trip: a bogus secret is sent to Appwrite,
rejected, and the screen reports it correctly. Unit tests cover token parsing
(including a link a mail client broke across a line), the cooldown arithmetic,
the password rules, and storage being unavailable in private browsing.

`RECOVERY_LINK_TTL_MINUTES` is asserted to be 60 because the screen promises
"expires in an hour" and Appwrite enforces exactly that — the copy and the
constant must not drift apart.

### Bugs found

1. **A default parameter swallowed an explicit `undefined`**, so the
   "no email known" test was silently exercising the with-email path and
   passing. Caught because the assertion contradicted itself.
2. **Reading `sessionStorage` in an effect** tripped
   `react-hooks/set-state-in-effect` — a cascading render, and a frame of wrong
   copy before it corrected. Replaced with `useSyncExternalStore`, whose server
   snapshot is null, so server and first client render agree.

### 🔴 SMTP is not actually live

I checked rather than assumed, and **`createRecovery` still returns
`503 general_smtp_disabled`.** The mail queue worker is up (`/health/queue/mails`
responds), so the container is running — Appwrite simply has no SMTP host.

My API key lacks `projects.read`/`platforms.read`, so I cannot read the
instance config to say which of these it is. In likelihood order:

1. **Configured at project level only** (Console → Settings → SMTP). This is
   the `[Unverified]` case flagged in `docs/appwrite-smtp.md` — the docs
   describe an empty instance-level `_APP_SMTP_HOST` as disabling mail *"from
   the server"*, which reads instance-wide. **Set the `_APP_*` env vars too.**
2. **Containers restarted rather than recreated.** `docker compose restart`
   does not re-read `.env`. It needs `docker compose up -d`.
3. Variables set but not applied — check with
   `docker compose exec appwrite vars | grep _APP_SMTP`.

**Nothing in this PR is blocked by it.** Every screen and state is built and
tested, and the one unverifiable step is that a real email arrives. When SMTP
is live, run `npm run e2e:auth` and then do one manual reset against a real
inbox — and remember the unverified-domain trap from §1 of the SMTP doc: with
`onboarding@resend.dev`, mail reaches your own address and nobody else's.

### Screenshots

`.shots/forgot.png` and `.shots/reset.png`, both 390pt, matching frames `01c`
and `01e`.
