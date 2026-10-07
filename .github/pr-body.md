## docs: beta capacity model for seven athletes

Ruairi's form answer (6 Oct) puts five athletes on the December beta; with
him and Joey logging as athletes that is seven. Nothing in the repo was sized
to a headcount. `docs/beta-capacity.md` is the model: low/base/high scenarios
with every formula shown, every invented input marked [Unverified], and the
five questions to put to Ruairi. No production code changes.

### What the numbers say

- **Storage is not the constraint.** Base case (7 athletes × 4 sessions × 4
  flagged sets × 20 s × 100 MB/min × 1.1 overhead) is 4.1 GB/week: 29 GB by
  31 Jan 2027, 3 % of the NAS's 941 GB. High case is 208 GB by January and
  overruns the NAS only at week 32, and only if the Cloud migration slips.
- **The 200 MB cap is invisible on the iOS default** (1080p30 HEVC reaches it
  at 185 s) and bites at 30 s on 4K60. Keep it; nudge athletes to 1080p.
- **Upload on gym wifi:** base clip 33 MB is 13–133 s across 20–2 Mbps,
  background and resumable. Compression not needed before December.
- **The first thing that breaks is the review queue, not the disk.** [Fact]
  `review-queue.tsx` sends every unreviewed id to `POST /api/clip` in one
  request; the route rejects more than `MAX_FILES = 60` and the component
  swallows the error, so above **61 unreviewed clips nothing plays**. Base
  produces 112 clips a week, so a coach reviewing weekly hits it every week.
  Client-side slice into 60s; should ship with Phase 3.
- **Ruairi's hour:** 112 clips at 45 s is 84 minutes against a 30–60 minute
  coach session. `video_required` is the throttle.
- **Backups:** `appwrite:backup` excludes the bucket (confirmed in
  `scripts/appwrite-backup.mts`), so the "dump is local only" item stays a
  few-MB `rclone` line. The clips have no backup at all; offsite is cents a
  month at these volumes.
- **Cloud:** Pro $25/project/month, extra storage $2.80/100 GB [Fact,
  changelog 2025-09-01]; 150 GB included [Unverified]. Base cohort crosses
  150 GB 8.4 months after migration and pays $1.78/month extra at a year.
  Four coaches at base cross it in about three months.

### Recommendation

No retention policy before migration; build the orphan sweep. Keep the cap.
No compression before December. Trigger: 61 unreviewed clips (fix the batch),
then 84 review minutes/week (Ruairi's call), then 470 GB on the NAS.

### Verification

Docs only. Numbers produced by a script outside the repo and rerunnable from
the formulas in section 2. No live instance or NAS access.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
