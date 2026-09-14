# Backing up the self-hosted Appwrite

Order 5. Ruairi's data is someone's livelihood even in beta, and the instance
is a single machine in a homelab.

There are two separate jobs here, and confusing them is how people end up with
neither:

| | What it protects against | Who owns it |
| --- | --- | --- |
| **Host-level backup** — Docker volumes and the MariaDB data directory | the machine dying, the disk failing, a bad `docker compose down -v` | the person who runs the box |
| **`npm run appwrite:backup`** — this document | a bad migration, a wrong `appwrite:reset`, a schema change that eats data, and moving to Cloud in January | this repo |

**The API-level dump is not a substitute for the host-level one.** It cannot
be: it does not hold password hashes, project settings, OAuth credentials or
SMTP config, and it never will. What it does hold is every row with the
permissions that make it readable, every account as an identity, and every
circle — replayable into *any* Appwrite instance, including Cloud.

---

## 1. Take a dump

```bash
npm run appwrite:backup                 # writes .appwrite-backup/<timestamp>/
npm run appwrite:backup -- --keep 14    # and prunes to the newest 14
```

`SNB_BACKUP_DIR` overrides where it writes.

Each dump is a directory:

```
2026-09-14T03-13-00-423Z/
  manifest.json          counts, endpoint, schema version, and what it omits
  tables/<table>.json    rows, each with $id and $permissions
  users.json             identities, no credentials
  teams.json             circles and their memberships
```

`manifest.json` is written **last**. A directory without one is a dump that
crashed half-way, and the restore refuses it rather than guessing.

### What it holds, and why each part is load-bearing

- **Rows with `$permissions`.** Under Appwrite the permissions *are* the access
  control — there is no policy to re-derive them from. A dump that loses them
  restores data nobody can read.
- **Users as identities.** Row permissions name `user:<id>`. Restore rows
  without their users and the permissions point at nothing.
- **Teams and memberships.** A coach's read comes from
  `team:circle_<athlete>`, so the circle graph is not metadata, it is the
  access model. See `appwrite/documents/circle.ts`.

### What it deliberately does not hold

- **Password hashes.** They are in the manifest's `omits` list for a reason:
  writing argon2 hashes and emails to unencrypted JSON would put a credential
  file on the same machine as the thing it is backing up. A restored account
  exists and is claimed through password reset or its OAuth provider. If you
  want credentials covered, that is the host-level backup's job.
- **OAuth provider tokens.** They belong to the provider.
- **Storage file contents.** No bucket exists yet. Revisit at Order 31, when
  video lands — video is the variable cost and will need its own answer.
- **Project settings, API keys, OAuth credentials, SMTP config.** Console
  state, not project data.

---

## 2. Schedule it

A nightly dump, keeping a fortnight. As the user that owns the checkout:

```
15 3 * * *  cd /path/to/SticksNBoulders && /usr/bin/npm run appwrite:backup -- --keep 14 >> /var/log/snb-backup.log 2>&1
```

The script exits non-zero if the dump is short or fails its own validation, so
a cron mail or a log check is enough to notice.

---

## 3. Get it off the machine — **still open**

**This step is not done.** Joey's call, 14 Sep 2026: build and verify the dump
first, leave the offsite copy as an explicit open task rather than guessing at
a destination.

Until it is done, the dump lives on the same disk as the database it protects,
which covers a bad migration and covers nothing else. Any of these closes it:

- `rclone copy` to B2, R2, S3 or Drive after the dump line above
- `rsync -a` over SSH to a second machine
- pointing `SNB_BACKUP_DIR` at a path something else already carries off the
  box (Syncthing, a mounted share, an existing backup agent)

A dump is a few hundred KB until video arrives, so cost is not the obstacle.

---

## 4. Restore

The dump holds rows, not the schema. The schema is code, and lives in
`appwrite/schema/` — a dump that also carried table definitions would give the
two a chance to disagree. So:

```bash
npm run appwrite:setup                                      # schema first
npm run appwrite:restore -- .appwrite-backup/<timestamp>     # plans, writes nothing
npm run appwrite:restore -- .appwrite-backup/<timestamp> --yes
```

Order is not a detail. The restore writes **users → teams → memberships →
rows**, because Appwrite validates a row's permissions when the row is written.
Rows first would produce permissions naming a team that does not exist yet: a
restore that looks clean while every coach screen comes back empty.

Before writing anything, the restore checks that every `user:` and `team:` the
rows' permissions name is present in the dump, and refuses the whole thing if
not. Re-running is safe; anything already there is counted and skipped.

Restoring into a different project is fine, and is how this reaches Cloud in
January. It says so when the project ids differ.

---

## 5. Prove it still works

```bash
npm run e2e:backup
```

Builds an athlete, a coach, a circle and a logged set on the live instance,
dumps it, **deletes all of it**, restores from the dump, and then checks the
only thing that really matters: that the coach can still read the athlete's set
afterwards. Removes its cast either way.

Run it after anything that touches the permission model, the circle model or
the schema. A dump nobody has restored is not a backup, it is a directory of
JSON that makes people feel safe.

Point it at dev. It deletes what it creates, but it creates real accounts.
