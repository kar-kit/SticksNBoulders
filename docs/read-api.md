# Personal read API (F29, schema v26)

Joey's ask, 10 Nov 2026: let Rubble pull his own sessions, program and maxes
into a chat (Powerlifting HQ attempt selection, say) without pasting numbers
in. It is also the official way in. Until now Rubble read live data with the
Appwrite admin key; after this, personal data goes through a scoped, logged,
revocable token, and the admin key is for ops only (schema, backups, e2e).

A read-only REST API, not an MCP server; an MCP wrapper can sit on these
endpoints later. Joey only for now, by allowlist.

## What it returns

All `GET`, all JSON, all `Cache-Control: no-store`. Weights are kilograms,
with a `units` hint (`kg` or `lb`, the athlete's display preference). Errors
are `{ "error": "<code>" }`.

| Route | Returns |
|---|---|
| `GET /api/v1/me` | `id`, `displayName`, `units`, and `token { id, label, expiresAt }`. The cheap call that proves a token works. |
| `GET /api/v1/sessions?from=&to=&limit=&cursor=` | `sessions[]` newest first: `id`, `startedAt`, `finishedAt`, `name`, `setCount`, `tonnageKg`; and `nextCursor`. |
| `GET /api/v1/sessions/:id` | `session`: the above plus `notes` and `sets[]`: `order`, `exercise { id, name }`, `setIndex`, `weightKg`, `reps`, `rpe`, `warmup`, `failed`, `notes`, `durationSeconds`, `level`. |
| `GET /api/v1/program/current` | `program` (or `null`): blocks, weeks, days, and per exercise its `lines[]`, each with `summary` and the resolved `sets[]` (`loadKg`, `reps`, `rpe`, `display`, `unresolved`, `backoff`). |
| `GET /api/v1/maxes` | `lifts[]`: `exercise`, `training`, `tested`, `bestE1rm` (each `{ valueKg, asOf }` or null) and `preferred { kind, valueKg }`. |

Nothing else: no clip, poster or proxy ids, no comments or reactions, no
coach notes beyond what My Program shows, no bodyweight, no rollups, no
draft weeks.

### Same numbers as the app

The API runs the app's own reads and arithmetic, never a copy. To make that
possible the browser-only stores were split (commit "share the app's read
paths"): the reads now live in `lib/strength/reference-max-read.ts`,
`lib/logging/history-sets.ts`, `lib/logging/session-rows.ts`,
`lib/programming/program-read.ts` and `profileFromRow` in
`lib/profile/profile.ts`, taking a reader. The stores pass the browser
session's tables; the API passes the owner's JWT client.

- **Session list:** History's numbers, the `set_count` and `tonnage_kg` stored
  on the session. `name` is the athlete's own name or the program day's
  label, as History shows it, and `null` where History would fall back to the
  date (that label depends on the phone's time zone; use `startedAt`).
- **One session:** the session screen's numbers, `totalsOf` over its sets
  (warm-ups and cardio out, a missed set in), in `setsBySession` order.
- **Program:** `readMyProgram` (published program, published weeks, drafts
  filtered twice), then exactly the day panel's chain in
  `program-screen.tsx`: `referenceLookup`, `planDay`, `basisMaxesFor`,
  `targetsFor` with the athlete's unit, `lineSummaries`. The unit changes the
  kilograms, not just the words: a derived weight is floored to loadable
  plates, 2.5 kg or 5 lb, so a pounds athlete's 75% of 200 kg is 149.685 kg,
  not 150. `summary` is My Program's line verbatim, in the athlete's unit.
- **Maxes:** `resolveMaxes` per lift (newest entry in effect by now; next
  block's max dated ahead is not in effect yet) and `preferredMax` (training,
  then tested, then e1RM). The e1RM is the best `best_e1rm_kg` across the
  rollups, never recomputed from sets.

### Sessions paging

`limit` defaults to 20, 1 to 100. `from` and `to` take a calendar day
(`2026-11-01`, UTC) or an ISO date-time; `from` is inclusive, a day `to`
includes that whole day, a date-time `to` is exclusive. `cursor` is the
previous page's `nextCursor`, and must be one of the owner's sessions or the
answer is 400 `invalid_cursor`. Follow `nextCursor` until it is `null`. A page
can be shorter than `limit` while `nextCursor` is still set: rows that fail
the authorship check (provenance.ts) are dropped after the read, and the
cursor moves past them so they cannot stall the pages behind.

## Auth

Personal access tokens: `snb_pat_` and 32 random bytes as 43 base64url
characters, sent as `Authorization: Bearer snb_pat_...`. The prefix means a
token is never mistaken for an Appwrite JWT, which `callerFrom` also takes as
a Bearer header, and makes a pasted one recognisable.

| Route | Auth | Does |
|---|---|---|
| `POST /api/tokens` `{ label, expiresInDays? }` | Appwrite JWT | 201 `{ id, token, expiresAt, label }`. Default 90 days, 1 to 365. At most 5 live tokens per user (409 `token_limit`). |
| `GET /api/tokens` | Appwrite JWT | `{ tokens[], maxLive }`: label, scope, created, expires, last used, revoked, `state`. Never the hash. |
| `DELETE /api/tokens/:id` | Appwrite JWT | Revokes the caller's own token, for good. Anyone else's, or an unknown id, is 404. |

All three are 401 without a session and 403 for a user id not on
`API_TOKEN_USER_IDS`. The 403 is also how Me decides whether to draw the
Connections row and screen (`components/profile/connections-link.tsx`,
`app/(athlete)/me/connections/`).

Storage is `api_tokens`: `owner_id`, `token_hash` (sha256 hex, unique),
`label`, `scope` (always `read`), `created_at`, `expires_at`, `last_used_at`,
`revoked_at`. The token itself is in the 201 response and nowhere else: not
in the table, not in a log, not in the browser past the moment the owner
presses Done.

### On every /api/v1 request (`lib/api/v1/serve.ts`)

1. **Method.** Anything but `GET` is 405 with `Allow: GET`, token or not.
2. **Token.** Looked up by its hash. Unknown, revoked and expired are one
   identical 401 `{ "error": "unauthorized" }`, so the API never says which.
3. **Rate limit.** 60 requests a minute per token, `createRateLimiter`, 429
   with `Retry-After` over it.
4. **Scope.** The API key mints a 60-second JWT for the token's owner
   (`Users.createJWT`, `appwrite/documents/api-reader.ts`), and every data
   read goes through a client built on that JWT with no key. Appwrite's row
   permissions decide what is visible, as they do in the app, so a bug in a
   query can narrow what the owner sees but never widen it.
5. **Own data only.** On top of Appwrite, every endpoint filters to the
   owner's own rows. A coach's JWT can read their athletes' sessions through
   the circle; this API is for a person's own training, so a coach's token
   gets 404 on an athlete's session it could open in the app.
6. **404, not 403.** Another athlete's id and an id that does not exist give
   the same 404, so the API never confirms an id exists.

The key does two things in this path and only two: mint the JWT, and read and
write the token and audit tables. It never reads a row of training data.

## Audit trail

`api_requests`: `token_id`, `owner_id`, `method`, `path`, `status`, `at`. One
row per call made with a token we issued, whatever the answer: 200s, 404s,
the 405 of a POST made with a real token, the 429s, the 401s of a revoked or
expired token. `path` keeps only the parameters the endpoint accepts, each
capped at 64 characters, so a caller cannot write free text into the trail
through the URL. `last_used_at` moves on every live-token call.

A call with no token, or one we never issued, has nobody to attribute it to
and writes no row. [Inference] That is the right trade: the trail answers
"what was done with my tokens", and an unauthenticated caller must not be
able to grow a table.

Rows are never edited and, in v1, never pruned. A failed audit write is
logged (`[api] audit write failed for token <id> ...`, never the token) and
the request is still answered: an audit outage must not take reads down.

Both tables grant no session anything, the owner included
(docs/permission-audit.md). Reading the trail is an admin read: the Appwrite
console, table `api_requests`, filtered on `owner_id` or `token_id`. There is
no screen for it in v1.

## Environment

| Name | Where | What |
|---|---|---|
| `API_TOKEN_USER_IDS` | Vercel (server), `.env.local` | Comma-separated Appwrite user ids allowed to mint tokens. Empty or unset is nobody. An entry that is not a user id disables minting for everyone until fixed (logged once, without the value). Ids, never tokens. |

Opening tokens up to every athlete later is deleting the allowlist check in
`app/api/tokens/gate.ts`; nothing in the schema depends on it.

## Tests

- Unit: `appwrite/documents/api-token.test.ts` (shape, bearer parsing,
  expiry, revocation, policy, writes), `api-token-admin.test.ts` (minting,
  hashing), `lib/api/allowlist.test.ts`, `app/api/tokens/route.test.ts` (401,
  403, mint, hash-only storage, 1-365 days, the 5-token cap, list, revoke,
  404 on someone else's), `app/api/v1/v1.test.ts` (one 401 for every kind of
  bad token, 405 on every endpoint, 429 at 61, the audit row and a failed
  audit write, JWT-only reads, 404-not-403, coach tokens, paging, the program
  against the app's own helpers in kg and lb, maxes), the Connections screen.
- `npm run e2e:api` (scripts/e2e-api.mts), against a running app. Athlete A
  has the fixed id `e2e-api-athlete-a` (`E2E_API_USER_ID` to change it),
  because the server must have A on its allowlist before the run starts:

  ```sh
  npm run build && API_TOKEN_USER_IDS=e2e-api-athlete-a npx next start -p 3120
  E2E_BASE_URL=http://localhost:3120 npm run e2e:api
  ```

  A's token reads A's sessions, program (75% of 200 kg is 150 kg, no draft
  week) and maxes, gets 404 on B's session and 405 on a POST, is refused after
  revoke; B gets 403 minting; every call made with the token has its row.
- `npm run appwrite:audit` covers both tables (nobody reads or writes, A
  included) and mints through the route with A on the allowlist for that run.

## Rollout (Joey; nothing goes live without his OK)

1. Review and merge the PR to `dev`.
2. `with-snb-env.sh npm run appwrite:setup -- --dry-run`. It should show
   exactly two new tables, `api_tokens` and `api_requests`, and nothing else.
   Then apply it. New tables only; no existing row is rewritten.
3. Set `API_TOKEN_USER_IDS` on Vercel (Production, and Preview if wanted) to
   the user id that holds Joey's own training. **Open question for Joey:**
   `jkkpang@gmail.com` or `kmhypeak@gmail.com`? Both are "Coach Joey".
4. Fast-forward `prod`. Then `with-snb-env.sh npm run appwrite:audit`, and
   `e2e:api` against live: that needs `e2e-api-athlete-a` on the live
   allowlist for the run (`<joey's id>,e2e-api-athlete-a`), removed after.
5. Joey mints a token on Me, Connections, labelled "Rubble". It is stored on
   bridge at `~/.config/snb/api-token` (chmod 600) and never written into
   RubbleOS notes.
6. From then on Rubble reads Joey's training through the API. The admin key is
   for ops only.

## Open items

- [Unverified] **The API key's scope for `Users.createJWT`.** Appwrite needs
  `users.write` on the key. No live credentials were used building this. The
  Vercel key very likely has it already, [Inference] because the clip stream
  route (`lib/video/clip-jwt.ts`) has called the same `Users.createJWT` with
  the same `APPWRITE_API_KEY` since PR #130; if clip playback works on prod,
  the scope is there. Confirm by step 4's `GET /api/v1/me` answering 200: a
  missing scope shows as 500 `failed` and an `[api] ... failed` log line.
- [Inference] **The rate limit is per Vercel instance**, in memory, so two
  warm instances allow 120 a minute between them. Fine for one user's token,
  where it stops a runaway script; a shared store is the change if tokens go
  to other athletes.
- **A JWT is minted on every request** (~80 ms through the tunnel, measured
  for the clip route on 2 Nov 2026). Not cached: one user, a handful of
  calls per chat. `ClipJwtCache` is the pattern if it ever matters.
- **Unknown-token calls cost one indexed lookup each** and are not limited by
  address. Not worth it for one user; worth a per-IP limiter before tokens
  are a product feature.
- **Exercise names** come from a lookup by id as the owner. A coach-created
  exercise the athlete cannot read (it is stamped for the coach's circle)
  comes back with `name: null`, where the app would show "Exercise".
  [Inference] rare: library lifts and the athlete's own cover almost every
  line.
- Later, not v1: an MCP wrapper, tokens for other athletes (remove the
  allowlist, add a permission-audit pass), bodyweight and rollups endpoints,
  OAuth for the claude.ai connector, pruning the trail.
