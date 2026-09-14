## FTP1-5 — Backups: a dump that can actually be restored

**Notion:** [MVP Feature List — Order 5](https://app.notion.com/p/c1595d12346b47fd9939ea81cd33ab4d)
**Depends on:** #1–#5 (all merged)

### Scope, and what was cut

Order 5 reads "Deploy pipeline, env config and backups". It is a `Source:
Inferred` row, and two thirds of it are already done or unspecified:

- **Env config: already done in #1.** `appwrite/env.ts` validates endpoint,
  project and database through Zod with a protocol check, with tests. Nothing
  to build.
- **Deploy pipeline: descoped, Joey's call, 14 Sep.** There is no deploy
  target. Appwrite is self-hosted by hand, Cloud is phase 5, and no host,
  staging or domain for the Next.js app has been described. Inventing a
  deployment story here would be inventing a requirement.
- **Backups: built, and this is the whole PR.** It is the half that is
  genuinely load-bearing — Ruairi's data is someone's livelihood even in beta.

### Appwrite has no backups to lend us

Self-hosted 1.9.0 returns `404 general_route_not_found` on
`/backups/policies` and `/backups/archives`. The Backups service exists in the
SDK and is Cloud-only, so the dump is ours to write.

### What a dump holds, and why each part is load-bearing

- **Rows with `$permissions`.** Under Appwrite the permissions *are* the access
  control — there is no policy to re-derive them from. A dump that loses them
  restores data nobody can read.
- **Users as identities.** Row permissions name `user:<id>`.
- **Teams and memberships.** A coach's read comes from
  `team:circle_<athlete>`, so the circle graph is the access model, not
  metadata.

**No password hashes.** Writing argon2 hashes and emails to unencrypted JSON
would put a credential file on the same machine as the database it protects.
The manifest states its own omissions in the file itself. A restored account is
claimed through password reset or its OAuth provider; credentials are the
host-level backup's job, and `docs/backups.md` draws that line explicitly.

### Restore order is the whole problem

**users → teams → memberships → rows.** Appwrite validates a row's permissions
when the row is written, so rows first would produce permissions naming a team
that does not exist yet: a restore that looks clean while every coach screen
comes back empty. Before anything is written, every `user:` and `team:` the
rows name is confirmed present in the dump, or the restore refuses outright.

### The bug this replaces

`appwrite-reset.mts` dumped every table before deleting it — with one
unpaginated `listRows`, which Appwrite caps at 25 rows. Any table larger than
that was silently truncated, and the reset then deleted the original. It shares
this code now.

Paging stops when a page comes back **empty**, not when it comes back short:
Appwrite caps page size server-side and the cap has moved between versions, so
stopping on a short page would truncate the moment the cap dropped below what
we asked for. Collected counts are reconciled against the instance's own total
— short throws, long is recorded, because a set can be logged mid-dump. Reads
pass `ttl: 0`, so a backup is never a backup of a ten-minute-old cached page.

### Verification

`npm run e2e:backup` — builds an athlete, a coach, a circle and a logged set on
the live instance, dumps it, **deletes all of it**, restores from the dump,
then checks the only thing that really matters:

```
Before the disaster        the coach can read the athlete's set to begin with
The dump                   holds the set, its permissions, the account, the circle
                           and no password material anywhere in it
After losing all of it     the set is gone
After restoring            same id, same load, byte-identical permissions
                           the account exists again, the circle has both members
                           THE COACH CAN READ THE SET AGAIN
                           restoring twice changes nothing

17/17 passed. Cast, circle and dump removed.
```

Retention was exercised against real dumps, not just unit-tested: `--keep 1`
pruned the two older valid dumps, kept the newest, and left a legacy-format
directory it could not verify untouched.

29 new tests, 517 total.

### Not in this PR — and it is a real gap

**Step 3, getting the dump off the machine, is not done.** Joey's call: build
and verify the dump first rather than guess at a destination. Until it is done
the dump sits on the same disk as the database it protects, which covers a bad
migration and a wrong `appwrite:reset`, and covers nothing else.
`docs/backups.md` §3 writes it up as the open task with three ways to close it,
so phase 0 ships knowing which guarantee it does not yet have.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
