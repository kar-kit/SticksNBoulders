## test: make the Appwrite and auth tests fail when the security code breaks

### Why

A mutation audit broke security-relevant code on purpose and ran the suite.
In these areas the whole suite stayed green. The tests fed only the inputs the
code was written for, or used stubs that ignored the queries they were sent,
so nothing checked the behaviour that matters most: who may act on which rows.

No product code changes in this PR. Every new test was checked by applying the
named mutation, watching the test fail, and restoring the source.

### What changes

**validate-row (the forged-row deleter).** The existing tests only fed it
forgeries, so a deleter that deleted every row passed. New tests: an honest
row is kept with no DELETE call; a server-only table is skipped;
`VALIDATOR_DRY_RUN=true` only logs; a non-event trigger is skipped (HTTP,
schedule, no header); a missing endpoint, project or execution key gives a
500 and an error naming what is missing.

**rollup-admin.** A forged 400 kg set stamped by a stranger is now ignored by
the rebuild, and a week made only of forged sets writes no rollup.

**link-admin.** The `listRows` stub now applies `equal` filters, and it caches
the way Appwrite's `ttl` docs describe unless `ttl: 0` is sent. New tests:
revoking athlete A never touches athlete B's link or circle (B's link comes
first in the table, so an unfiltered read would pick it up); another
athlete's coach neither blocks a redemption nor counts as "linked"; a second
coach's code redeemed straight after the first is refused.

**sign-in form.** The create-path test mocked `email-taken`, which skipped the
hint check before the mode guard was reached. It now uses
`invalid-credentials` with a Google hint ready, so removing `&& !creating`
fails it.

**role.ts.** Removed the `NOT_A_COACH` tautology. Added real
`fetchCoachStatus` tests against a fake that applies `equal`, `limit` (25 by
default) and `select`: revoked links are excluded, only the caller's
`coach_id` rows count, a roster above 25 is kept, the cap is 100, and blank
ids are dropped.

**clip-admin.** Deleted the test whose runtime assertion checked nothing. Its
real check, that a hand-built object is not a `ClearedOrphan`, now sits in
`orphans.test.ts` as a `@ts-expect-error` that `npm run typecheck` enforces.

**API routes.** Added `app/api/route-test-kit.ts`, an in-memory node-appwrite
(Client, Account, TablesDB, Teams, Users) that applies JWTs and query filters,
refuses admin calls made without the API key, and throws on any filter it
cannot apply. The routes and their admin modules run unchanged against it.
New tests:

- `link/routes.test.ts`: redeem, resolve, revoke and coach. Each returns 401
  with no token and with a bad token. Redeem and resolve also return 401
  before they read a junk code. Both give 429 per athlete (10) and per IP
  (30), and junk input uses no budget. A redeem or revoke that names another
  athlete in the body acts only on the caller. The coach route answers only
  about the caller and never returns an email address.
- `invite`, `circle`, `rollup`, `reference-max`, `program`: each returns 401
  with no token or a bad one, and ignores a coach id or athlete id sent in the
  body. For reference-max, a revoked coach and a stranger both get 403.
- `auth/method-hint`: the hint is given only for passwordless accounts and
  only for the address asked about. It returns 429 per email (5) and per caller
  IP (10) with the same body shape, and non-addresses use no budget.

### Mutations now caught (38 of 38)

| Area | Mutation |
|---|---|
| validate-row | `if (verdict.action !== "delete")` to `if (false)`; dry-run check removed; trigger check removed; endpoint/project/key guard removed (endpoint and key, separately) |
| rollup-admin | `isAuthentic` filter removed |
| link-admin | `athlete_id` filter removed; `ttl: 0` removed |
| sign-in form | `&& !creating` removed |
| role.ts | `status=active` removed; `coach_id` filter removed; `limit` removed; limit changed to 500; blank-id filter removed |
| orphans (typecheck) | `ClearedOrphan` brand removed |
| link routes | no-token early return removed (redeem, resolve); rate-limit check disabled (redeem, resolve); per-athlete limiter keyed on IP instead; junk-code early return removed; revoke trusts body athlete id; 401 on a bad token swallowed (revoke, coach) |
| other routes | 401 on a bad token swallowed (invite, circle, rollup, reference-max, program); body id trusted (invite, circle, rollup); method-hint IP limit, email limit, email filter and junk check removed; reference-max `mayWriteFor` always true; reference-max `status=active` removed |

### Not done / for a reviewer

- The circle body-id test passed its mutation at first, because `ensureCircle`
  only ever adds the id it is given. It now checks that no circle is created
  for the id named in the body, and it catches the mutation.
- `app/api/clip/*` was left alone because another branch owns it.
- `stops at 100 athletes` pins the current roster cap. A coach with more than
  100 links loses the rest with no warning. That is a product decision, so
  this PR leaves it alone.
- The link-admin fake treats an omitted `ttl` as cached. The SDK docs do not
  say what the server does by default, so the fake is the stricter reading.
- Read-only questions below remain open because they need the live instance.

### Open questions (not changed here)

- **`method-hint/route.ts:48`, `hasPassword = Boolean(user.password)`.** The
  node-appwrite 28.0.0 typings declare `Models.User.password?: string`
  ("Hashed user password") and `hash?`. The field is optional, and neither the
  typings nor `docs/permission-audit.md` say whether `users.list` fills it in
  on 1.9.6. If the list leaves it out, every password account looks
  passwordless. The route would then confirm that every registered address
  exists and show the wrong "use Google" hint. To confirm, call `users.list`
  with the API key for a known password account and check `password`.
- **`lib/auth/athletes.ts:24,30`.** It selects `["user_id", "display_name"]`
  and then runs `authenticRows("profiles", …)`, which requires `$id ===
  user_id`. The appwrite 26.2.0 typings type `Models.Row.$id` as always
  present, but those types ignore `select`, so they guarantee nothing. The
  `Query.select` JSDoc says only "which attributes should be returned".
  `docs/permission-audit.md` records that select keeps `$permissions` and
  says nothing about `$id`. If `$id` is dropped, every profile fails the check
  and the coach rail shows "Unnamed athlete". To confirm, inspect one live
  `listRows` response that uses this select.
