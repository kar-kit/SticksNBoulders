## Order 38 — Permission audit + fix row forgery

The audit (first half of this PR) found a sev-1: any signed-in user could
write a row into anybody's data. Every table with `create("users")` accepted a
row carrying somebody else's `athlete_id`, `owner_id`, `coach_id` or
`author_id`, stamped `read("users")` — a role every session holds — and every
read filtered on those columns. Proven on the live instance: a forged 400kg
set became A's best e1RM through `/api/rollup`, forged coach comments, forged
"reviewed" marks clearing clips, a forged `is_global` exercise in everyone's
typeahead. The second half of this PR fixes it, defence in depth, and the
audit now asserts every one of those is neutralised.

### The fix

**A row's stamp proves who wrote it.** A session cannot stamp a role it does
not hold, so `update("user:<athlete_id>")` on a set is proof that athlete
wrote it; `update("user:<author_id>")` on a comment, `update("user:<coach_id>")`
on a review. `appwrite/documents/provenance.ts` is that check in one place —
`ownerProof`, `isAuthentic`, `authenticRows`, `verdictFor` — with
`expectedStamp` moved in beside it so the readers, the audit and the Function
share one definition. Tested against every forgery in the finding.

**Readers only trust what the owner stamped.** Every store reading a
client-writable table filters through `authenticRows`; `rebuildRollup` (route
and repair script) and `e1rm:backfill` skip sets the athlete did not stamp;
`fetchProfile` reads a squatted row as absent. Selects now carry the owner
column (`Query.select` keeps `$permissions` but not data columns). Logged sets
still write locally first and sync through the queue — nothing moved
server-side.

**The library carries the server's mark.** A forged `is_global: true` row had
exactly the stamp a seeded one did. Library rows now also carry
`update("team:library")`: a team `appwrite:setup` creates with the API key and
that has no members, so no session can stamp it and nobody can create it
first. `exercises:seed` re-stamps (56 rows re-stamped live on 6 Oct). Simpler
than splitting the table; typeahead and create-on-the-fly unchanged.

**A Function deletes what lands.** `functions/validate-row`, declared in
`appwrite/functions/index.ts`, deployed by `npm run appwrite:functions`
(esbuild bundles provenance.ts in — one definition, not a copy). Fires on row
create *and* update; deletes a row in a client-writable table that names an
owner and lacks that owner's proof. Delete rather than revert on update: the
event carries no previous state, and a relabelled row is a false claim whatever
it said before. Scoped so a bug cannot mass-delete: one row per event, writable
tables only, never a row without an owner, never for a stale *read* stamp.
`VALIDATOR_DRY_RUN=true` is the kill switch.

**Relabelling and squatting**, the two the finding had not asserted, are
covered by the same two layers and now asserted by the audit.

### The audit, extended

- A forgery Appwrite accepts shows as `landed*` and counts as refused only if
  no reader trusts it. 23 land; none is trusted.
- "What a forged row does once it lands": rollup, coach's queue, review mark,
  comment thread, typeahead, relabel, squat — all proven inert on the live
  instance.
- The validator: every landed row must be deleted within 45s, polled by id;
  fails outright when the Function is not deployed.
- Orders 19/22/28/43 from `dev`: rules for the five program tables
  (server-only; read by coach, athlete, circle), `/api/program` — including
  `duplicateWeek` and `copyProgram`, with a copy onto an athlete the coach
  does not link to refused — and `/api/link/suggestions`, exercised with real
  JWTs for every role, before and after revocation. The
  stamp scan also checks `isAuthentic` on every row, `suggestions_mode`'s
  values, and that program children name their program's coach and athlete.
- Discovery asserts the `library` team exists with no members and the
  Function is deployed, enabled and subscribed.

### What is not done, and why

**The Function is not live.** [Fact] The instance's builder answers every
deployment with `Internal server error` within 3 seconds — including a
redeploy of the probe's own archive that built on 14 Sep — and only `node-22`
is enabled in `_APP_FUNCTIONS_RUNTIMES`. The host is not reachable from the
MacBook. On the host: `docker ps | grep -E 'executor|worker-builds'`,
`docker logs appwrite-worker-builds --tail 100`, `docker logs
appwrite-executor --tail 100` (or `openruntimes-executor`), `df -h`, then
`npm run appwrite:functions`. Until then the audit reports exactly two
failures, both "validate-row is not live"; everything else passes (463/465 on
6 Oct). Readers already hide every forged row, so the live product is
protected; the Function is the second layer.

**Sign-ups stay open.** The API key cannot reach `/projects/*` (console
scope), and Appwrite 1.9 has no invite-only mode — the only control is Auth →
Security → Users limit, which would stop athletes registering to redeem a
code. [Inference] Left unchanged; the fix removes what a stranger's account
could do.

### Verification

`lint` · `typecheck` · **1917 tests, 120 files** · `npm run appwrite:audit`
live: 463/465, the two validator checks failing as above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
