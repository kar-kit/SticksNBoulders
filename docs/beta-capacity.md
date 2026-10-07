# Beta capacity: video at seven athletes

_Written 7 Oct 2026 against Ruairi's form answer of 6 Oct: **five athletes** join
the December beta. With Ruairi and Joey logging as athletes that is **seven**.
Nothing in the repo was sized to a number of people; the only scale text was
"one coach, a handful of athletes" (docs/review-queue.md). This is the model._

Every number here comes from the formulas in section 2 and the inputs in
section 3, so the whole thing reruns by hand. Inputs that nobody has confirmed
are **[Unverified]** and listed again in section 9 as questions for Ruairi.

## 1. What the repo fixes, and what it does not

[Fact] from the code and docs on `origin/dev`:

| Fixed by the repo | Where |
| --- | --- |
| Per-clip cap **200,000,000 bytes** (200 MB); `checkClip` refuses before upload | `lib/video/clip.ts` `MAX_VIDEO_BYTES`; `appwrite/schema/index.ts` `maximumFileSizeBytes` |
| Accepted types `mp4`, `mov`, `m4v`, `webm` | same two files |
| Upload chunk 5 MiB, **sequential**, one JWT per attempt, 5 attempts then dropped | `lib/video/chunks.ts`, `lib/video/upload.ts`; docs/video-upload.md |
| Resume across a drop and a reload is built and proved (`e2e:video`) | docs/video-upload.md closes the `[Unverified]` in CLAUDE.md |
| Clips live on the TrueNAS NFS export mounted at `/mnt/snb-data`, **941 GB free on 15 Sep 2026**; the NAS holds the only copy | docs/video.md, docs/video-upload.md |
| No client-side compression ("recommended against, for now") | docs/video-upload.md |
| Detach and re-film **do not delete** the old file; orphans are left for a sweep that does not exist | docs/video.md, `lib/video/upload.ts` ~174 |
| `appwrite:backup` **excludes storage files** | `scripts/appwrite-backup.mts` header; docs/backups.md "What it deliberately does not hold" |
| Review queue: reads up to **300** clips (`MAX_CLIPS`), 100 per page; mints playback tickets for the whole unreviewed queue in **one** `POST /api/clip`, which rejects more than **60** ids | `lib/review/queue-store.ts`, `components/coach/review-queue.tsx` ~193, `app/api/clip/route.ts` `MAX_FILES` |
| Tickets live 5 minutes; the proxy streams unbuffered with range support, `preload="metadata"` | `lib/video/ticket.ts`, `app/api/clip/[fileId]/route.ts`, `clip-player.tsx` |
| `video_required` on a prescription is a nudge, never a gate | docs/programs.md "Video required (Order 30)" |

Not fixed anywhere: a retention policy, an orphan sweep, a backup of the clips,
a number of athletes, sessions, or clips.

## 2. Formulas

```
clip_MB          = clip_seconds × rate_MB_per_min / 60
clips_per_week   = athletes × sessions_per_week × flagged_sets_per_session
GB_per_week      = clips_per_week × clip_MB × overhead / 1000
GB_per_month     = GB_per_week × 52 / 12
cumulative_GB(w) = GB_per_week × w              (w = weeks since hand-over)
share_of_NAS     = cumulative_GB / 941

cap_bites_at_s   = 200 / (rate_MB_per_min / 60)   (seconds of recording that reach 200 MB)
upload_seconds   = clip_MB × 8 / uplink_Mbps
chunks           = ceil(clip_MB × 1e6 / 5,242,880)
playback_Mbps    = rate_MB_per_min × 8 / 60       (what the homelab uplink must sustain for smooth scrub)
review_minutes   = clips_per_week × seconds_per_clip / 60
cloud_$          = 25 + max(0, stored_GB − 150) × 0.028   per month, per project
```

`overhead` covers re-films and detached clips whose files stay behind, since
nothing deletes them. Decimal MB and GB throughout (the cap is 200,000,000
bytes, not 200 MiB).

## 3. Inputs

### What a phone records

[Fact] iOS defaults to **1080p HD at 30 fps** in Settings › Camera › Record
Video, and to **High Efficiency (HEVC)** in Settings › Camera › Formats on
every iPhone since the 7. Settings shows the storage per minute as a footnote
under each option.

| Setting | MB per minute | Basis |
| --- | --- | --- |
| 1080p30 HEVC (default) | 65 | [Unverified] remembered from the iOS 17/18 footnote; Apple's older H.264-era footnote said 60 and that figure is web-confirmed |
| 1080p30 H.264 "Most Compatible" | 130 | [Unverified] same footnote |
| 1080p60 HEVC / H.264 | 100 / 175 | [Unverified]; older footnote 90 |
| 4K30 HEVC / H.264 | 170 / 350 | [Unverified]; older footnote 170 |
| 4K60 HEVC / H.264 | 400 / 440 | 400 is web-confirmed for the older footnote; the split is [Unverified] |

Confirmation is thirty seconds on any iPhone: Settings › Camera › Record
Video reads the figures off the screen. Android phones vary more widely and
nobody has asked what the five athletes carry (form question 13, unanswered).

What a 10, 20 and 30 s clip weighs, `clip_MB = s × rate / 60`:

| | 10 s | 20 s | 30 s | cap bites at |
| --- | ---: | ---: | ---: | ---: |
| 1080p30 HEVC | 11 MB | 22 MB | 33 MB | 185 s |
| 1080p30 H.264 | 22 MB | 43 MB | 65 MB | 92 s |
| 1080p60 HEVC | 17 MB | 33 MB | 50 MB | 120 s |
| 1080p60 H.264 | 29 MB | 58 MB | 88 MB | 69 s |
| 4K30 HEVC | 28 MB | 57 MB | 85 MB | 71 s |
| 4K30 H.264 | 58 MB | 117 MB | 175 MB | 34 s |
| 4K60 HEVC | 67 MB | 133 MB | **200 MB** | **30 s** |
| 4K60 H.264 | 73 MB | 147 MB | **220 MB** | **27 s** |

### Behavioural inputs, all [Unverified] unless marked

| Input | Low | Base | High | Why |
| --- | --- | --- | --- | --- |
| Athletes | 6 | 7 | 7 | [Fact] 5 from the form + Ruairi + Joey; low assumes one drops out |
| Sessions / week / athlete | 3 | 4 | 5 | [Unverified] typical powerlifting split; **ask Ruairi** |
| Video-flagged sets / session | 2 | 4 | 8 | Ruairi: "mainly compounds, plus accessories when I have questions". Low = one top set of each of two compounds; base = top set plus a back-off on two compounds; high = every working set of the compounds plus two accessories |
| Clip length | 15 s | 20 s | 30 s | [Unverified] walk-out, 1–5 reps, rack; 30 s covers a paused triple with a long setup |
| Rate (MB / min) | 65 | 100 | 170 | Low = everyone on the iOS default. Base = a mixed fleet, 0.5×65 + 0.3×100 + 0.2×170 ≈ 97, rounded to 100. High = everyone on 4K30 HEVC, or an Android fleet at high bitrates |
| Overhead (re-films, orphans) | 1.00 | 1.10 | 1.25 | nothing deletes a detached file |
| Hand-over | 14 Dec 2026 | | | CLAUDE.md "mid Dec 2026" |
| Weeks to 31 Jan 2027 | 7 | | | |
| 12-month horizon | 52 weeks | | | only matters if the Cloud migration slips |

## 4. Storage

| | Low | Base | High |
| --- | ---: | ---: | ---: |
| Clip size | 16 MB | 33 MB | 85 MB |
| Chunks per clip | 4 | 7 | 17 |
| Clips / week | 36 | **112** | 280 |
| GB / week | 0.58 | 4.1 | 29.8 |
| GB / month | 2.5 | 17.8 | 129 |
| Cumulative to 31 Jan 2027 | 4 GB | **29 GB** | 208 GB |
| Share of 941 GB at 31 Jan | 0.4 % | 3.1 % | 22 % |
| Cumulative at 12 months | 30 GB | 214 GB | 1,547 GB |
| Share of 941 GB at 12 months | 3 % | 23 % | **164 %** |

[Inference] Storage is not the beta's constraint. Base consumes 3 % of the NAS
by the January migration, and even the high case leaves three quarters free.
The NAS only fills if the migration slips **and** the high case holds: at 29.8
GB/week the 941 GB is gone at week 32, late July 2027. Base never fills it
within the year.

The ceiling that does move is the one in section 6.

## 5. The 200 MB cap

[Fact] The cap bites at the lengths in the right-hand column of the table in
section 3. In words:

- On the iOS default (1080p30 HEVC) a clip has to run **over three minutes**
  to hit it. No set does. The cap is invisible.
- At 1080p60 or 4K30 HEVC it bites at **70–120 s**. A single set still fits;
  a clip left rolling across two sets does not.
- At **4K60 it bites at 30 s** (HEVC) or 27 s (H.264), which is the high
  scenario's clip length and a realistic walk-out-plus-triple. An athlete who
  has turned 4K60 on for other reasons gets "That clip is 2xx MB. The limit is
  200MB" on a normal set, and that message arrives after they have racked the
  bar and tapped the camera, not before they filmed.

So the cap bites for exactly one group: people on 4K60 or any 4K H.264. It
bites on length-of-set, not on anything the product controls. The fix for
that group is an onboarding line ("film at 1080p; Settings › Camera › Record
Video") rather than code. Lowering the cap would not help them and would start
catching 1080p60 clips of long sets.

## 6. Upload time on gym wifi

[Fact] Ofcom's Mobile Matters 2025 (Opensignal data, Oct 2024–Mar 2025)
found 18 % of 5G NSA uploads below 2 Mbit/s and about 30 % at or above 20
Mbit/s; 71 % of UK connections were still on 4G. Gym wifi is unmeasured and
form question 14 (does the gym wifi have a login page) is unanswered. So
2 Mbps is a plausible bad case, 20 Mbps a good one.

`upload_seconds = clip_MB × 8 / uplink_Mbps`, sequential chunks:

| Clip | 2 Mbps | 5 Mbps | 10 Mbps | 20 Mbps |
| --- | ---: | ---: | ---: | ---: |
| Low, 16 MB | 65 s | 26 s | 13 s | 7 s |
| Base, 33 MB | 133 s | 53 s | 27 s | 13 s |
| High, 85 MB | 340 s | 136 s | 68 s | 34 s |
| 4K60 at the cap, 200 MB | 800 s | 320 s | 160 s | 80 s |

Per athlete per session the upload runs in the background while they rest:
base is 133 MB a session, 3.6 minutes at 5 Mbps spread across a 90-minute
session. High is 680 MB a session, 18 minutes at 5 Mbps, which on a
2 Mbps connection becomes 45 minutes and is still finishing when the athlete
drives home. The resume path then carries it, which means the blob sits in
IndexedDB; docs/video-upload.md already flags eviction on a nearly full phone
as [SME to confirm], and the high case makes that a 680 MB question rather than
a 33 MB one.

[Inference] Compression is not needed for upload time in the low or base
cases. It becomes a comfort feature in the high case and a necessity only for
the 4K60 outlier, who is better served by the settings nudge.

## 7. Review queue

This is where seven athletes bite first.

| | Low | Base | High |
| --- | ---: | ---: | ---: |
| Clips / week landing in Ruairi's queue | 36 | **112** | 280 |
| Raw footage / week | 9 min | 37 min | 140 min |
| Review time at 45 s a clip [Unverified] | 27 min | **84 min** | 210 min |
| Egress through `/api/clip` per week | 0.6 GB | 3.7 GB | 24 GB |
| Playback bitrate the homelab uplink must sustain | 8.7 Mbps | 13 Mbps | 23 Mbps |

Three consequences, in order of urgency.

**The 60-ticket batch.** [Fact] `review-queue.tsx` passes every unreviewed
`videoFileId` to `fetchClipUrls`, which sends them in one `POST /api/clip`;
the route returns 400 above `MAX_FILES = 60`; the component swallows the
error, so no URL is minted and every clip in the queue shows the player's
"would not play". At the base rate of 112 clips a week, a coach who reviews
once a week **opens a queue of 112 and cannot play anything**, and a coach
who clears it twice a week is fine until a holiday. The threshold is
**61 unreviewed clips**; low reaches it in 12 days unreviewed, base in four,
high in a day and a half. It is a client-side batching fix (slice into 60s,
as `fetchExerciseNames` already does with `PAGE`), not a capacity problem,
but it is the first thing this model predicts will break. The 300-clip
`MAX_CLIPS` read ceiling is the next wall, reached in the high case after
eight days unreviewed.

**Ruairi's hour.** CLAUDE.md sizes the coach session at 30–60 minutes weekly.
Base generates 84 minutes of review at 45 s a clip. [Inference] Either the
flagged-set count is lower than four a session, or Ruairi reviews on more
than one day, or he skips through most clips in under 20 s. Whichever it is,
the product's real capacity limit is coach attention, and the lever that sets
storage, upload load and review time together is `video_required` on the
prescription (docs/programs.md). It is already a nudge rather than a gate; it
is also the throttle.

**Homelab uplink.** [Unverified] The homelab's upstream bandwidth is not
written down anywhere. Playback goes Appwrite → Next.js proxy → coach's
browser, so the uplink must exceed the clip's bitrate for the scrub bar to
keep up: 8.7 Mbps on the iOS default, 23 Mbps in the high case, 53 Mbps for
a 4K60 clip. A 20 Mbps upstream plays base clips and stutters on 4K. Weekly
egress of 4 GB (base) is trivial on any plan; bitrate is the constraint, not
volume.

## 8. Backups and the Cloud bill

### What `appwrite:backup` protects

[Fact] It dumps rows, users and teams; it does not touch the bucket
(`scripts/appwrite-backup.mts` lines 7–9, docs/backups.md). A dump stays at a
few hundred KB to a few MB at seven athletes, so the open step 3 ("get it off
the machine") remains an `rclone` line with no size problem.

The clips are a different item and nobody owns it. docs/video.md: "The NAS
dataset now holds the only copy of every clip. It needs its own snapshot
task; nothing else is backing it up." A ZFS snapshot on the same pool
protects against a bad delete, not a dead pool. An offsite copy of the
bucket, at B2/R2-class pricing of about $6 per TB-month [Unverified, list
price from memory]:

| | Low | Base | High |
| --- | ---: | ---: | ---: |
| Offsite clips at 31 Jan | 4 GB, $0.02/mo | 29 GB, $0.17/mo | 208 GB, $1.25/mo |
| Offsite clips at 12 months | 30 GB, $0.18/mo | 214 GB, $1.28/mo | 1.5 TB, $9.28/mo |

Cost is not the obstacle for either item; the obstacle is that the row dump
and the file copy are two jobs and only one has a script.

### Appwrite Cloud after January

[Fact] Appwrite's 1 Sep 2025 changelog: Pro is **$25/month per project**, 2 TB
bandwidth included, extra storage **$2.80 per 100 GB per month**, extra
bandwidth **$15 per 100 GB**. [Unverified] Pro includes **150 GB** storage;
secondary sources agree, confirm on appwrite.io/pricing before relying on it.

`cloud_$ = 25 + max(0, stored − 150) × 0.028`, beta cohort only:

| | Low | Base | High |
| --- | ---: | ---: | ---: |
| Months after migration until stored clips exceed 150 GB | 59 | **8.4** | 1.2 |
| Stored at 12 months | 30 GB | 214 GB | 1,547 GB |
| Monthly bill at 12 months | $25.00 | $26.78 | $64.12 |
| Bandwidth / month (upload once, stream once) | 5 GB | 36 GB | 258 GB of 2,000 |

[Inference] Storage add-on cost is noise against the $25 base: the base case
pays an extra $1.78 a month after a year. The exposure is not the beta
cohort; it is that three more coaches arrive in January with their own
athletes, and each coach's roster adds roughly a base-case column. Four
coaches at base is about 70 GB a month, over 150 GB inside three months,
and still only about $20 a month in storage add-on after a year. Video is
the variable cost, but at these prices it does not set the price floor.

Two Cloud checks before migration, both [Unverified]: whether Cloud's
per-file upload limit on Pro is at or above 200 MB (if Cloud caps lower the
`checkClip` constant has to drop with it), and whether the Cloud bucket
counts the orphans a detach leaves behind (it will, so the sweep is worth
having before the first bill).

## 9. Ask Ruairi

The five inputs that move the numbers most, in the order they matter:

1. **Sessions per week per athlete**, and whether all five follow the same
   split. Moves every row linearly. Form left it blank.
2. **How many sets he actually wants filmed** per session: one top set per
   compound, or every working set? This is the 2-vs-4-vs-8 that separates
   a 27-minute review from a three-hour one.
3. **Phones** (form question 13, unanswered): iPhone or Android, and has
   anyone set 4K or 60 fps. Decides whether the cap is invisible or bites on
   every set.
4. **Gym wifi** (form question 14, unanswered): login page or not, and a
   speed-test upload figure from the platform area. Decides whether the
   base case uploads in 13 s or 133 s.
5. **His review rhythm**: one sitting a week, or most evenings. Decides how
   fast the queue crosses 61 clips and whether 84 minutes is a problem.

One for Joey, not Ruairi: the homelab's upstream bandwidth in Mbps.

## 10. Recommendation

**Retention: none before migration; sweep orphans, keep everything else.**
Base reaches 29 GB by 31 Jan on a 941 GB disk. A time-based policy
(delete clips older than N days) would be solving a problem that is a year
away in the base case and would delete the one thing a coach wants to scrub
back to when a lift changes. What is worth building is the orphan sweep
docs/video.md already describes, because at a 10–25 % re-film rate the
orphans are the only waste, and on Cloud they bill. Revisit retention when
the four-coach cohort passes 150 GB on Cloud, roughly three months after
migration in the base case.

**Cap: keep 200 MB.** It is invisible on the iOS default, bites only on 4K60
and 4K H.264, and lowering it would start catching 1080p60 clips of long sets.
Replace it with a one-line onboarding nudge to film at 1080p, and surface the
"too big" message so it names the setting to change.

**Compression before December: no.** Upload time is 13–53 s per clip across
plausible uplinks in the base case and the upload is already resumable and
background. Compression would cost the 2.5 s interactive budget to shave
seconds off something the athlete does not wait for. The in-app
`MediaRecorder` capture docs/video-upload.md proposes is the right shape if
the high case materialises; decide on it in February with real clip sizes
from the bucket rather than this table.

**The first number that triggers action: 61 unreviewed clips in one coach's
queue.** Above it `POST /api/clip` returns 400 and nothing plays. Base
reaches it after four days unreviewed; the fix is to batch `fetchClipUrls`
into slices of 60, and it should ship with Phase 3, before Ruairi's first
Sunday with a week of clips. The second number is **84 minutes** of review a
week at base, which is Ruairi's problem to size and `video_required` to
throttle. Storage gets its own trigger only at **470 GB on the NAS** (half of
941), which the base case never reaches and the high case reaches in
sixteen weeks if the migration slips.
