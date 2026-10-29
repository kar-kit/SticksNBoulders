# Clip proxies: a normalised H.264 copy of every clip (schema v22)

_29 Oct 2026. Source: Joey. Beta hand-over 14 Dec 2026._

## Why

[Fact] (Joey) Clips on the server are 98-151 MB each, and playback runs coach
→ Vercel `/api/clip` → Cloudflare tunnel → Traefik → Appwrite → NFS. Two things
about an iPhone clip make that path worse than it needs to be:

- **Codec.** iPhones record HEVC by default. [Inference] A coach on Windows
  Chrome or Firefox may not decode HEVC at all (it depends on the GPU and the
  OS's HEVC extension), so the player shows nothing.
- **Layout.** A phone often writes the `moov` atom (the index) after the
  media. A browser cannot start until it has the index, so it either waits
  for the whole file or issues extra range requests to the end first.

So every clip gets a **proxy**: H.264, at most 1080p and 60fps, `moov` first,
and the players load that.

## Decisions (Joey's, not reopened here)

| | |
| --- | --- |
| Proxy format | H.264, **capped** at 1080p and 60fps. Caps, not targets: never upscaled, never more frames (30fps stays 30, 720p stays 720p) |
| Where the cap lives | One value, `PROXY_CAP` in `lib/video/proxy-profile.ts` |
| The original | Kept until the proxy is verified, then deleted 7 days later |
| Scope | One PR against `dev`. No phone-side encoding, no moving the stream off Vercel, no resumable-upload change, no UI redesign |

## The pattern: F12 posters, again

[Fact] The proxy reuses the poster's shape (docs/video.md, "Thumbnails"),
deliberately, because every one of its properties was already reviewed:

- **Derived id.** `<clipId>_proxy` (`appwrite/documents/proxy.ts`
  `proxyIdFor`). Every path that knows a clip knows its proxy: cleanup, the
  sweep, the backup, e2e purge. The worker's upload is idempotent (409 = there).
- **A column that says "made and verified".** `sets.video_proxy_id`,
  nullable, no index. Only the worker writes it (`setProxyOnSet`,
  `appwrite/documents/proxy-admin.ts`), only after ffprobe has passed the
  file, and it writes only that column.
- **A pure reader check.** `proxyOf(row)` accepts the column only when it is
  the proxy of the row's own `video_file_id`. A row whose clip was replaced
  still names the old proxy until the worker catches up; it plays the new
  original, never the old take.
- **Permissions are the clip's.** `proxyPermissions` *is* `videoPermissions`:
  athlete and circle read, the athlete deletes, the coach cannot.
- **Bucket `set_video_proxies`.** mp4 only, 200 MB like the clip bucket,
  compression none, encryption **off** (Appwrite skips encryption above 20 MB,
  so on it would encrypt short proxies and silently not long ones), and **no
  bucket-level create for anyone**. Unlike clips and posters, no session ever
  writes here.

`video_file_id` stays the clip's identity forever, including after the
original is pruned: poster and proxy ids hang off it, and reviews record it
(v18).

## The worker: `npm run clips:proxies`

```
npm run clips:proxies                          # plan only, writes nothing
npm run clips:proxies -- --yes                 # make, verify, upload, point
npm run clips:proxies -- --yes --retry-failed  # also retry clips that failed in the last 24h
npm run clips:proxies -- --prune               # plan which originals could go
npm run clips:proxies -- --prune --yes         # delete them
```

`scripts/clip-proxies.ts` is pure orchestration over injected deps (tested
without a server or ffmpeg), `scripts/make-clip-proxies.mts` wires Appwrite
and ffmpeg, `scripts/proxy-ffmpeg.ts` holds every ffmpeg decision.

Per clip, one at a time:

1. Stream the original to a temp file (never into memory), `ffprobe` it.
2. **Remux or encode.** Already H.264 (Baseline/Main/High), 8-bit 4:2:0, not
   HDR, inside the cap and under 10 Mbps: `-c copy -movflags +faststart`
   (seconds, no quality loss). Otherwise encode with `nice -n 19`:
   libx264 High, yuv420p, CRF 23, maxrate 10 Mbps / bufsize 20 Mbps, preset
   veryfast, AAC 96k stereo (copied if already AAC on a remux, `-an` when
   there is no audio), `+faststart`. Only the first video and audio streams
   are mapped; iPhone timed-metadata tracks are dropped.
3. **Filters**, in order, each only when needed: `fps=<cap>` when the source
   is above the cap; scale to fit the cap, orientation-agnostic (a portrait
   4K clip becomes 1080 x 1920; ffmpeg applies the rotation flag before the
   filters); HDR tone-map; `format=yuv420p`. VFR is kept as VFR with
   `-fps_mode passthrough` (`-vsync` on ffmpeg older than 5.1).
4. **Verify** (`verifyProxy`): a video stream exists, codec h264, pixel format
   4:2:0, duration within 0.5 s of the source, `moov` before `mdat` (read from
   the top-level box headers), dimensions and frame rate within the cap. A
   proxy that fails is deleted (it was never uploaded), the clip is reported,
   and the set stays on its original.
5. Re-read the set: upload only if it still names this clip. Upload with the
   athlete's stamp, then check the stored size matches.
6. Re-read the set again, immediately before the write, and point it.

Idempotent and safe to re-run, like `clips:posters`:

| Found at the proxy id | What happens |
| --- | --- |
| Nothing | make, verify, upload, point |
| A finished file with exactly the athlete's stamp, set not pointed (a run died) | download it, **verify again** against the original, then point. Fails: deleted and remade next run. Fails with the original gone: left alone, it is the only copy |
| An unfinished upload with the athlete's stamp (a run died mid-upload) | deleted and made again |
| A file with any other permissions | left alone, reported (`squatted`) |
| Clip id too long for a derived id (hand-made fixtures) | left alone; plays its original |

**Failures back off.** A clip that fails (no zscale for an HDR clip, an
undecodable file, a failed verification) is recorded in a ledger outside the
checkout (`~/.cache/snb-clip-proxies/failures.json`, `SNB_PROXY_STATE` to
move it) and retried after 24 hours, or at once with `--retry-failed`. The run
exits non-zero whenever something failed, so `systemctl status` and the
journal show it. A lock in the same directory stops a manual run and the timer
overlapping.

**Polling, not events.** [Inference] A missed Appwrite event is a clip that
never gets a proxy; a missed poll is a clip that gets one a minute later. The
plan costs one paged read of `sets` plus one `getFile` per set without a
proxy, which is small next to one transcode.

## HDR (must read before trusting colour)

[Fact] iPhone 12 and later record HDR by default: 10-bit HEVC with HLG
transfer (`color_transfer=arib-std-b67`), often with a Dolby Vision 8.4 layer
on top. Squeezing that to 8-bit SDR without tone-mapping gives flat,
washed-out colour.

The worker detects HDR from ffprobe's `color_transfer` (`arib-std-b67` = HLG,
`smpte2084` = PQ) and inserts:

```
zscale=tin=<source transfer>:min=<source matrix>:pin=<source primaries>:t=linear:npl=100,
format=gbrpf32le, zscale=p=bt709, tonemap=tonemap=hable:desat=0,
zscale=t=bt709:m=bt709:r=tv, format=yuv420p
```

and tags the output BT.709. This needs ffmpeg's **zscale** (libzimg) and
**tonemap** filters. It checks for both at start-up (`ffmpeg -filters`) and,
if either is missing, refuses each HDR clip with a message naming the fix
rather than produce a washed-out proxy. That clip stays on its original
(which still plays wherever HEVC does) and is retried daily.

- [Inference] Debian and Ubuntu's apt `ffmpeg` is built with libzimg, so
  forge's packaged ffmpeg should have zscale. Check before relying on it:
  `ffmpeg -hide_banner -filters | grep -E ' (zscale|tonemap) '` must print
  two lines.
- **[Unverified] on a real iPhone HDR clip.** The local ffmpeg (Homebrew 8.1.2)
  has no zscale, so the tone-map chain was never run here; only the detection
  and the loud refusal were. First thing to check on forge: make a proxy of
  one of Joey's own HDR clips and compare it with the original side by side.
- [Inference] Dolby Vision is ignored: ffmpeg decodes the HLG base layer,
  which is what the chain expects.

## Playback, and deploy skew

`POST /api/clip` takes an optional `proxies` map (clip id → the proxy id its
row names). For a clip whose entry is its own derived proxy it mints a ticket
for the proxy, with `bucketId: "set_video_proxies"` signed into it; the URL is
still keyed by the clip id, so no screen changed shape. `fetchClipUrls` sends
the map only when there is something in it, so a row with no proxy sends the
exact pre-v22 body.

`GET /api/clip/[fileId]` takes the bucket **only from the signed ticket**,
checked against `PLAYABLE_BUCKETS` (`set_videos`, `set_video_proxies`). A
ticket that names no bucket opens the clip bucket. A proxy ticket whose file
Appwrite does not have falls back to the clip it was derived from, as the same
user, so a deleted proxy still plays the original while it exists. Range is
forwarded and the body streamed unbuffered, as before.

Screens that play the proxy: the Review Queue (`components/coach/review-queue.tsx`),
the coach's athlete Videos dialog (`components/coach/athlete-videos.tsx`), the
athlete's clip screen (`app/(athlete)/history/clips/[setId]/clip-detail.tsx`)
and Coach feedback (`app/(athlete)/today/feedback/feedback-screen.tsx`). Each
reads `video_proxy_id` through `proxyOf` (`toClip`, `feedback-store`).

Skew, each direction [Inference]:

| Old | New | Result |
| --- | --- | --- |
| client (cached service worker bundle, open tab) | server | Sends no `proxies`; gets the original. Correct until prune; why prune waits (below) |
| ticket (minted before deploy) | stream route | No `bucketId` → clip bucket. Plays |
| server | client | Ignores `proxies`, mints originals. Plays |
| stream route | ticket with `bucketId` | Would 404 (fetches the proxy id from the clip bucket). Needs the mint and the stream on different deployments within a 5-minute ticket; the player's one refresh re-mints from the current deployment |

The service worker never touches `/api/*` (`public/sw.js`), so no cached
response can carry a stale URL.

`feedback-store` now selects `video_proxy_id`. Selecting a column the instance
lacks is refused, so **v22 must be applied before this client deploys**, the
same constraint as v19's `failed`.

[Inference] When the worker points a set, Realtime fires a `sets` update and
the Review Queue refetches and re-mints. A coach watching that clip at that
moment gets the proxy URL in place of the original. That is the same reload
every Realtime refresh already causes (each re-mint is a new ticket URL), not
a new behaviour.

## Prune: deleting originals

Never part of the default run. `--prune` plans; `--prune --yes` deletes. An
original goes only when, re-checked against a fresh read immediately before
the delete (`clearForPrune`, `appwrite/backup/prune.ts`):

- the set still names this clip **and** plays its proxy (`proxyOf`);
- the proxy file exists, finished uploading, is not empty, and carries exactly
  the athlete's stamp (only the worker can create there, and it uploads only
  verified files);
- the proxy file is **7+ days old** (`PRUNE_AFTER_DAYS`);
- no other set names the same clip without playing its proxy.

The delete goes through the write helper (`deletePrunedOriginal` in
`appwrite/documents/clip-admin.ts`), which takes only what `clearForPrune`
makes.

[Inference] Prune does not demand a backup covering the original, unlike
`clips:sweep --delete`. The original has been in every nightly dump since the
night after it was filmed, and `--keep 14` holds it for two weeks after the
prune; after that the proxy is the only copy. That is Joey's decision
(original deleted 7 days after the proxy), stated here so it is a known one.

## Every consumer of `video_file_id` that assumed the original exists

| Consumer | Verdict |
| --- | --- |
| Players (queue, Videos dialog, clip screen, feedback) | **Fixed**: play the proxy when the row names one |
| `deleteClipIfUnused` (`lib/video/clip-cleanup.ts`), behind Delete clip, Replace (Log, edit sheet, History, Clips screen) and set delete | **Fixed**: deletes clip, poster and proxy; each 404 is success, so a pruned original is fine |
| `clips:sweep` (`appwrite/backup/orphans.ts`) | **Fixed**: the proxy of a live clip is kept, pointed or not (derived from `video_file_id`); the proxy of a replaced, detached or deleted clip is an orphan; a clip with no proxy yet is not "dangling"; a pruned original is listed as "plays its proxy, original pruned", apart from real dangling rows. Same age and backup-coverage rules |
| `appwrite:backup` | **Already covered**: dumps every bucket in the schema, so proxies are copied from v22 on. A pruned original is simply absent from later dumps |
| `appwrite:restore` validation | **Fixed**: a set whose original is missing but whose proxy the dump holds raises no warning |
| `clips:posters` | **Fixed**: renders from the proxy when the original is gone |
| Poster ids, review records (v18), `hasVideo`, the queue's `isNotNull` | **Unaffected**: they use the id, never the bytes |
| `e2e:prune` / e2e crash net (`scripts/e2e-purge.ts`) | **Fixed**: reaches the proxy bucket through the derived id, under the same fixture-ownership checks |
| `reviews:clips` (v18 backfill) | **Documented**: reads the original's `$createdAt`; a pruned original reads as "clip file not found" and that review is skipped. It is a one-off; run it before enabling prune if it has not been |
| e2e scripts that delete their own clip | **Documented**: if the timer made a proxy of a fixture clip mid-run, the proxy becomes an orphan the sweep reclaims (and `e2e:prune` removes) |

## Permission audit

`appwrite/audit/rules.ts` has a `set_video_proxies` rule. Read, update and
delete mirror `set_videos` cell for cell. **Create differs by design**: the
bucket grants create to nobody, so A's own upload must be refused too (it is
`yes` for clips). The audit writes A's proxy with the API key, as the worker
does. [Inference] The rule adds 20 matrix cells (5 roles x 4 ops) and two
checks (the key writes the target; the ex-coach cannot read the proxy after
revocation), so the next full run should report 22 more than the last one.
**[Unverified]**: not run; `appwrite:audit` is Joey's, against the live
instance.

## Checked locally (ffmpeg 8.1.2, synthetic clips)

[Fact] Synthetic sources made with ffmpeg's `testsrc2`, each run through the
real `readProbe` → `planProxy` → ffmpeg → `verifyProxy`, outside the repo:

| Source | Plan | Result |
| --- | --- | --- |
| HEVC 3840x2160 60fps | encode, scale 1920x1080 | h264 1920x1080@60, verified |
| HEVC 4K60, portrait flag | encode, scale 1080x1920 | h264 1080x1920@60, verified |
| H.264 1080p30 at 17 Mbps | encode (over the 10 Mbps ceiling) | h264 1920x1080@30, verified |
| H.264 1080p60 at 8 Mbps | remux | 60 stays 60, verified |
| H.264 720p30, H.264 no audio, H.264 portrait flag | remux | verified; no-audio has no audio track |
| H.264 with PCM audio | remux video, AAC audio | verified |
| H.264 720p120 | encode, `fps=60` | 1280x720@60, verified |
| VFR (nominal 60, average 40.3), H.264 and HEVC | remux / encode with passthrough | 80 frames in, 80 out: no invented frames |
| HEVC Main 10 HLG (`arib-std-b67`), landscape and portrait | refused | "needs ffmpeg's zscale (libzimg) filter ... washed out ... SNB_FFMPEG" |

Every source file had `moov` after `mdat`; every proxy had
`ftyp > moov > free > mdat`. The unit tests pin the same decisions against
ffprobe JSON fixtures (`scripts/proxy-ffmpeg.fixtures.ts`).

## Judgement calls, all [Inference]

1. **Audit create cell = nobody**, not "mirrors set_videos": the spec's two
   requirements (mirror cell for cell; no bucket-level create) cannot both
   hold for create.
2. **A failure ledger with 24h backoff.** A per-minute timer would otherwise
   re-download and re-fail the same 150 MB HDR clip every minute.
3. **Existing proxy files are re-verified before pointing**, downloading the
   original for the duration check. Costs a download, never a transcode.
4. **A failing stored proxy whose original is gone is left alone**, not
   deleted: it is the only copy.
5. **The stream route falls back from a missing proxy to its original.** Not
   asked for; ten lines, and it turns "proxy deleted" from a dead player into
   the pre-v22 behaviour.
6. **`attachVideo` does not clear `video_proxy_id`** on replace. `proxyOf`
   already makes a stale pointer read as none, and leaving the client write
   path untouched means no deploy ordering for writes. The sweep reclaims the
   stale proxy; `deleteClipIfUnused` usually gets it first.
7. **The sweep derives the proxy reference from `video_file_id`** rather than
   reading `video_proxy_id`, so an uploaded-but-not-yet-pointed proxy is never
   an orphan, and a stale pointer never keeps an old proxy alive.
8. **Remux needs a known bitrate ≤ 10 Mbps.** A file that does not report one
   is re-encoded rather than trusted.
9. **The cap is orientation-agnostic** (long edge 1920, short edge 1080), so
   portrait clips are 1080 x 1920, not 608 x 1080.
10. **Prune does not require backup coverage** (see Prune).
11. **Changing the cap does not redo existing proxies** (below), and a set
    pointed at a proxy that was later deleted plays its original via the
    stream route's fallback rather than being re-made. Checking every
    pointed proxy on every tick would be a `getFile` per filmed set per
    minute.

## Runbook for Joey (live instance, in order)

1. **Schema.** `npm run appwrite:setup -- --dry-run` must print exactly these
   two lines and nothing else (pinned in `appwrite/schema/execute.test.ts`):

   ```
     would create bucket set_video_proxies
     would create column sets.video_proxy_id (string)
   ```

   Anything more means the instance drifted from v21; look before applying.
   Then `npm run appwrite:setup`.
2. **Deploy the app** (merge to `dev`, then the usual promotion). Not before
   step 1: `feedback-store` selects the new column.
3. **On forge, check ffmpeg:**
   `ffmpeg -version | head -1` and
   `ffmpeg -hide_banner -filters | grep -E ' (zscale|tonemap) '` (two lines).
   No zscale means HDR clips will be refused; everything else still works.
4. **Plan:** `npm run clips:proxies`. Reads only. It prints the ffmpeg
   capabilities and how many proxies it would make.
5. **First run by hand:** `npm run clips:proxies -- --yes`. One clip at a
   time, so the backlog can take a while; it is safe to stop and re-run.
   Then open one proxy of an **HDR** clip and one of a portrait clip next to
   their originals (the [Unverified] above).
6. **Install the timer** (below), then watch one tick:
   `journalctl -u snb-clip-proxies -f`.
7. **Audit:** `npm run appwrite:audit`. Expect the `set_video_proxies` row:
   read A + coach, create nobody, update nobody, delete A.
8. **Later, prune.** Once proxies have played for a week and the coach has
   used them: `npm run clips:proxies -- --prune` (plan), then
   `-- --prune --yes`. Give old tabs and cached bundles a week after step 2
   first: an old client asks for the original, and a pruned original is a
   dead player there. Run `npm run reviews:clips` before the first prune if it
   has not been run since v18. To run prune weekly, copy the unit below with
   `--prune --yes` and `OnCalendar=Sun 04:00`.

### systemd on forge

`/etc/systemd/system/snb-clip-proxies.service`:

```ini
[Unit]
Description=SticksNBoulders clip proxies (npm run clips:proxies -- --yes)
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
# The user that owns the checkout and its .env.local.
User=websprint-server
WorkingDirectory=/path/to/SticksNBoulders
ExecStart=/usr/bin/npm run clips:proxies -- --yes
# The worker already runs ffmpeg under nice -n 19; this covers npm and node too.
Nice=19
IOSchedulingClass=idle
# A long backlog run is fine; the timer waits for it.
TimeoutStartSec=6h
# Environment=SNB_FFMPEG=/usr/local/bin/ffmpeg
```

`/etc/systemd/system/snb-clip-proxies.timer`:

```ini
[Unit]
Description=Make clip proxies a minute after the last run finished

[Timer]
OnBootSec=2min
# Measured from the end of the previous run, so runs never overlap.
OnUnitInactiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now snb-clip-proxies.timer
systemctl list-timers snb-clip-proxies.timer
journalctl -u snb-clip-proxies --since today
```

[Inference] `User=websprint-server` and the checkout path are guesses from
docs/video.md (the compose file lives under `/home/websprint-server`); use
whatever user runs `clips:posters` today. A unit in `failed` state after a run
means a clip failed and was recorded in the ledger; the next tick runs anyway.

### Changing the cap to 720p

Edit one line in `lib/video/proxy-profile.ts`:

```ts
export const PROXY_CAP: ProxyCap = { longEdge: 1280, shortEdge: 720, fps: 60 };
```

Pull it into forge's checkout (the worker runs from there) and deploy the app
as usual. New proxies follow it. **Existing proxies are not redone**: a set
already pointed at a verified proxy counts as done, and deleting its proxy file
by hand does not change that (the row still names the proxy; playback falls
back to the original through the stream route, and the worker never remakes
it). Redoing old proxies needs a `--rebuild` mode that clears
`video_proxy_id` through the write helper and re-queues the clip. Not built,
to keep the PR small, and only possible while the originals exist, so decide
on 720p **before** enabling prune.

## Files

| File | What it holds |
| --- | --- |
| `lib/video/proxy-profile.ts` | `PROXY_CAP` and the encoder settings |
| `appwrite/documents/proxy.ts` | `PROXY_BUCKET`, `proxyIdFor`, `proxyOf` |
| `appwrite/documents/proxy-admin.ts` | `setProxyOnSet`, the one write of `video_proxy_id` |
| `appwrite/documents/policy.ts` | `proxyPermissions` |
| `appwrite/documents/clip-admin.ts` | `deletePrunedOriginal`, `deleteWorkerProxy` |
| `appwrite/backup/prune.ts` | `clearForPrune`, `PRUNE_AFTER_DAYS` |
| `scripts/proxy-ffmpeg.ts` (+ `.fixtures.ts`) | probe, plan, filters, verification, box walk |
| `scripts/clip-proxies.ts` | plan/apply and prune orchestration |
| `scripts/make-clip-proxies.mts` | `npm run clips:proxies` |
| `lib/video/ticket.ts` | `bucketId` claim, `PLAYABLE_BUCKETS`, `playbackTarget` |
| `lib/video/clip-source.ts` | what a screen hands `fetchClipUrls` |
