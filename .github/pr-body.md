## Clip backup, offsite copy, and an orphan-clip sweep

docs/beta-capacity.md §8 named two gaps before Ruairi's athletes upload:
`appwrite:backup` skipped the video bucket, so the NAS held the only copy of
every clip, and the dump never left the machine (open since Order 5). Separately,
a detached clip's file is never deleted, so orphans pile up and will bill on
Cloud. This PR closes both. No live instance or NAS was touched; everything
below "Run live" is for Joey.

### Backup now holds the clips

- [Fact] `appwrite:backup` lists every bucket in `schema.buckets` and streams
  each finished file into `<SNB_BACKUP_DIR>/files/<bucket>/<id>`, recording
  id, permissions, size and sha256 in the dump's new `files.json`. Format v2;
  v1 dumps still restore, with a warning that they hold no clips.
- **API, not the NFS mount.** File `$permissions` live in Appwrite's
  database, not on the NAS, so a filesystem copy restores clips nobody can read.
  The on-disk layout is Appwrite-private, and Cloud has no mount. The API also
  reports `chunksUploaded`, so partial uploads are named in the manifest and
  not copied. The cost is that each clip crosses Appwrite once.
- The store is shared across dumps because files are immutable, so each night
  fetches only new clips. A copy is renamed into place only once its size
  matches `sizeOriginal`. A short copy is retried once; a second short copy
  fails the run. `--keep` prunes clips that no kept dump names, and prunes
  nothing if any kept dump's list is unreadable.
- **Offsite:** `SNB_BACKUP_OFFSITE` (documented in `.env.example`) is an
  rsync destination, either a mounted path or `host:path` over SSH. Clips go
  first, then the dump, with `manifest.json` last. Nothing is deleted at the
  destination, the value is never logged, and destinations that rsync would
  read as an option are refused. A failed copy exits 1.
- **Restore** writes users → teams → memberships → **files** → rows. It checks
  that every role named in a clip's permissions is present in the dump and
  re-hashes every clip before writing anything, including in plan mode.

### Orphan sweep: `npm run clips:sweep`

The default is a dry run that lists orphans and reclaimable MB. `--delete` is
the only way to remove anything, and it deletes nothing unless the newest dump
is under 26 h old and holds every orphan with a matching size and re-hashed
bytes. The check is all or nothing. References are read again before deleting.
The delete goes through the write helper (`appwrite/documents/clip-admin.ts`),
which accepts only a `ClearedOrphan` branded type, so the backup check is
enforced by the compiler.

What counts as an orphan:
- Any reference keeps a file, including two sets on one file and ids that
  differ only by case or whitespace.
- **Unfinished uploads are never swept**, even when they are ancient. The
  athlete may still resume one, and no backup can cover a partial file.
- A finished file stays until 14 days after it was last touched (`--min-age-days`,
  floor 7). This covers an attach queued on a phone that lost signal as the
  upload finished.
- Undatable or future timestamps keep the file.
- A file is swept when its clip was detached, its set was deleted, or the set
  was deleted before the attach landed.
- A test fails if any schema column named like a file id is missing from
  `CLIP_REFERENCES`.

### Open, labelled

- [Inference] 14 days is a guess at the longest gap between app opens.
- [Unverified] `$updatedAt` moves with each chunk. If it does not, the age
  runs from the first chunk.
- [Unverified] Files page correctly with `cursorAfter` in default order (rows
  use `orderAsc("$id")`; not assumed for files). `pageThrough` refuses to loop
  and the run fails loudly if not.
- Uploads abandoned after 5 attempts stay partial forever and are only
  counted. What to do about them is Joey's call.
- The restore writes clips through the backup driver, outside the write helper,
  the same documented exemption `putRow` already uses: it replays recorded
  permissions and does not stamp new ones.

### Verified offline

`npm test` 131 files / 2107 tests (was 127 / 2020; +87, all in
`appwrite/backup/{bucket,orphans,offsite,files,restore,dump}.test.ts` and
`appwrite/documents/clip-admin.test.ts`). `npm run lint` and
`npm run typecheck` are clean. A smoke run of all three scripts with blanked
config shows that the imports resolve and the argument guards reject
`--delet` and `--min-age-days 3`.

### Run live (Joey), in this order

1. In `.env.local` on the backup host, set `SNB_BACKUP_OFFSITE` to a
   destination **off the TrueNAS pool**, and create that directory. For SSH,
   check that `ssh <host> true` works non-interactively as the cron user.
2. Check free space for `SNB_BACKUP_DIR` against the bucket size; the first
   run fetches every clip.
3. `npm run appwrite:backup`: expect a `bucket set_videos` line with N files,
   `N copied`, and "Copied off the machine." Confirm that the file count
   matches the console.
4. `npm run appwrite:backup` again: expect `0 copied, N already held`. This
   confirms the cursor paging and reuse.
5. `npm run appwrite:restore -- .appwrite-backup/<newest>`: **plan only, no
   `--yes`**. Expect no BLOCKING and every clip hash-checked.
6. Repeat step 5 against the offsite copy if it is mountable, to prove the far
   copy restores.
7. `npm run e2e:backup` against dev; this proves the row path still works.
8. `npm run clips:sweep`: dry run. Review the orphan list and check that the
   last line says every orphan is held.
9. Only then, optionally, `npm run clips:sweep -- --delete`.
10. To settle the `$updatedAt` question, interrupt an upload, resume it
    minutes later, and compare `$createdAt` and `$updatedAt` on the file in
    the console.

The cron line in docs/backups.md §2 is unchanged; it picks up
`SNB_BACKUP_OFFSITE` from `.env.local`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
