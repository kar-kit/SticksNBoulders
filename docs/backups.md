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
permissions that make it readable, every account as an identity, every
circle, and every finished clip with its permissions — replayable into *any*
Appwrite instance, including Cloud.

---

## 1. Take a dump

```bash
npm run appwrite:backup                 # writes .appwrite-backup/<timestamp>/
npm run appwrite:backup -- --keep 14    # and prunes to the newest 14
```

`SNB_BACKUP_DIR` overrides where it writes. `SNB_BACKUP_OFFSITE` copies it
off the machine afterwards — step 3.

Each dump is a directory, and clips live once in `files/` beside them:

```
.appwrite-backup/
  files/set_videos/<fileId>   clip bytes, shared by every dump
  2026-10-07T03-15-00-000Z/
    manifest.json             counts, endpoint, schema version, buckets, and what it omits
    files.json                each clip: id, permissions, size, sha256
    tables/<table>.json       rows, each with $id and $permissions
    users.json                identities, no credentials
    teams.json                circles and their memberships
```

`manifest.json` is written **last**. A directory without one is a dump that
crashed half-way, and the restore refuses it rather than guessing. A clip is
written beside its final name and renamed into place only once its size
matches what Appwrite reports, so a file under `files/` is always a whole one.

Clips are shared because Appwrite files are immutable: fourteen nightly
copies of the same clip would be fourteen times the disk. Each night fetches
only clips the previous dump did not hold. The first run fetches the whole
bucket — size `SNB_BACKUP_DIR`'s disk for it (docs/beta-capacity.md: about
29 GB by 31 Jan in the base case).

`--keep` prunes dumps, then deletes any clip no kept dump names. A clip
deleted from Appwrite therefore stays recoverable for the retention window
and then goes. If a kept dump's `files.json` cannot be read, no clips are
pruned at all.

### What it holds, and why each part is load-bearing

- **Rows with `$permissions`.** Under Appwrite the permissions *are* the access
  control — there is no policy to re-derive them from. A dump that loses them
  restores data nobody can read.
- **Users as identities.** Row permissions name `user:<id>`. Restore rows
  without their users and the permissions point at nothing.
- **Teams and memberships.** A coach's read comes from
  `team:circle_<athlete>`, so the circle graph is not metadata, it is the
  access model. See `appwrite/documents/circle.ts`.
- **Clips with `$permissions`.** A clip is stamped per file, exactly like a
  row, so its permissions are kept for the same reason. A set restored
  without its clip is a dead player in the review queue.

### Why clips are read through the API, not off the NFS mount

The bytes sit on the TrueNAS export (docs/video.md), and reading the mount
directly would skip a network hop. It reads the API instead, because:

- **Permissions live in Appwrite's database, not on the NAS.** A copy of the
  bytes alone restores video nobody can read.
- **The layout under `/storage/uploads` is Appwrite's private business**, with
  no compatibility promise across upgrades — and Cloud, in January, has no
  mount at all. The API is the same in both places.
- **The API knows which uploads are unfinished** (`chunksUploaded`). The
  filesystem holds their partial chunks too, with nothing to say so.
- The script then runs from wherever the checkout is, not only on the
  Appwrite VM.

The cost is that every clip crosses Appwrite once. Downloads stream to disk
rather than going through `storage.getFileDownload`, which buffers a whole
file in memory.

### What it deliberately does not hold

- **Password hashes.** They are in the manifest's `omits` list for a reason:
  writing argon2 hashes and emails to unencrypted JSON would put a credential
  file on the same machine as the thing it is backing up. A restored account
  exists and is claimed through password reset or its OAuth provider. If you
  want credentials covered, that is the host-level backup's job.
- **OAuth provider tokens.** They belong to the provider.
- **Uploads still in flight.** A partial upload is not a playable clip, no
  set points at one yet, and the athlete's phone still holds the original.
  The manifest names them under `buckets[].incomplete`.
- **Project settings, API keys, OAuth credentials, SMTP config.** Console
  state, not project data.

---

## 2. Schedule it

A nightly dump, keeping a fortnight. As the user that owns the checkout:

```
15 3 * * *  cd /path/to/SticksNBoulders && /usr/bin/npm run appwrite:backup -- --keep 14 >> /var/log/snb-backup.log 2>&1
```

The script exits non-zero if the dump is short, a clip comes back short
twice, the dump fails its own validation, or the offsite copy fails — so a
cron mail or a log check is enough to notice.

---

## 3. Get it off the machine

Set `SNB_BACKUP_OFFSITE` and every dump is copied there with `rsync` after it
is written:

```bash
SNB_BACKUP_OFFSITE=/mnt/offsite/snb          # a share mounted from elsewhere
SNB_BACKUP_OFFSITE=backup-box:snb            # or host:path over SSH
```

The destination directory must already exist. It is a place, never a
credential: SSH authenticates with the keys in `~/.ssh`, and the script never
prints the value.

**It must not be on the TrueNAS pool that holds the clips.** A copy on the same
pool is not off the machine; it dies with the pool.

The copy runs in three steps — `files/`, then the dump without its manifest,
then the manifest — so an interrupted copy leaves a directory the restore
refuses, never one it trusts. Clips already at the destination are not sent
again. rsync checks a whole-file checksum on everything it transfers.
Nothing is ever deleted at the destination: pruning is local, so a bad local
prune cannot reach the far copy, and the far copy's retention is whoever owns
that box.

Without the variable the dump stays local, and the script says so on every
run. B2, R2 or Drive are reachable by mounting them (e.g. `rclone mount`) and
pointing the variable at the mount; this script only speaks rsync.

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
files → rows**, because Appwrite validates permissions when they are written.
Rows first would produce permissions naming a team that does not exist yet: a
restore that looks clean while every coach screen comes back empty. Files sit
before rows because a set names its clip.

Before writing anything, the restore checks that every `user:` and `team:` the
rows' and clips' permissions name is present in the dump, and refuses the
whole thing if not. It then reads every clip in `files/` beside the dump and
checks it against the sha256 the dump recorded — in the plan too, so a bad
copy is found before `--yes`. Re-running is safe; anything already there is
counted and skipped.

Restoring from the offsite copy works the same way: pass the dump directory
there, with `files/` beside it.

A v1 dump (taken before clips were backed up) still restores, with a warning
that it holds no clips.

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
the schema. It creates no clip, so it proves the row path only; the clip path
is covered by unit tests and by the first real restore. A dump nobody has restored is not a backup, it is a directory of
JSON that makes people feel safe.

Point it at dev. It deletes what it creates, but it creates real accounts —
and its restore step replays the whole dump, not only its own cast. On dev that
is a no-op, since everything else still exists and is skipped as already there.
On an instance where something was legitimately deleted between the dump and
the restore, it would bring that back.

---

## 6. Sweep orphaned clips

Detaching a clip, re-filming, or deleting a set leaves the file behind, on
purpose (docs/video.md). They are reclaimed here:

```bash
npm run clips:sweep                        # lists orphans and reclaimable MB, deletes nothing
npm run clips:sweep -- --min-age-days 21   # a longer grace period (minimum 7)
npm run clips:sweep -- --delete            # deletes them
```

A file is an orphan only if no set's `video_file_id` names it, its upload is
**finished**, and it was last touched more than **14 days** ago. In order:

| Case | Verdict |
| --- | --- |
| Any set points at it — one set or several | kept |
| Upload unfinished (lost signal mid-upload; phone may still resume it) | kept, always; listed as uploading |
| Finished but touched within 14 days — the attach may still be queued on the phone | kept, listed |
| Timestamps unparseable or in the future | kept |
| Detached, re-filmed, or its set deleted (by the athlete, or before the attach landed) | orphan |

The 14 days covers the slow path: the upload finishes as the athlete loses
signal, the phone never hears it finished, and the attach is queued only on
the next app start with signal. [Inference] nobody has measured how long
athletes go between opens. [Unverified] that `$updatedAt` moves with each
chunk, which would date a resumed upload from when it finished; if it does
not, the age runs from the first chunk and the margin absorbs it.

Uploads abandoned after five attempts stay unfinished forever and are never
swept: no backup can hold a partial file, so none could cover deleting it.
The dry run counts them. What to do about them is open.

**`--delete` refuses, deleting nothing,** unless the newest dump under
`SNB_BACKUP_DIR` is under 26 hours old and holds every orphan at the same size,
with its stored copy re-hashed and matching. All or nothing. The dry run runs
the same check and says whether `--delete` would pass. References are read
again after the check and anything attached meanwhile is kept. The delete
itself goes through the write helper (`appwrite/documents/clip-admin.ts`),
which accepts only a file that check has cleared.

A swept clip is recoverable with `appwrite:restore` from the covering dump
while `--keep` retains it, and from the offsite copy after that.

The residual race: a phone that finishes an upload, then stays offline more
than 14 days before its queued attach lands, gets a set pointing at a deleted
clip. The covering dump still holds it.
