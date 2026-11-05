# Push notifications for the coach (F27, schema v25)

Ruairi's ask: tell him when an athlete submits a video or answers a comment,
without him having to open the app to find out. Web push, to the PWA on his
phone and to any browser he turns it on in.

## What notifies, and who

| Event | Notifies | Never |
|---|---|---|
| A set gains a clip (create with `video_file_id`, or an update whose clip file is under 10 minutes old) | every coach on an **active** link to the athlete | the athlete; a self-coached athlete; a revoked coach |
| A comment created by the athlete on their own set (`author_id === athlete_id`) | the same | the coach's own comments; edits; deletes |
| Anything else: reactions, reviews, weigh-ins, unrelated set edits | nobody | |

Forged rows (a set or comment whose stamp does not prove its author,
`isAuthentic` in provenance.ts) never notify: validate-row deletes them
within seconds and they must not reach a lock screen first.

Each coach has per-type switches, **New clips** and **Athlete replies**,
stored on each device row and applied to all of that coach's devices.

## Pieces

| Piece | Where |
|---|---|
| Table `push_subscriptions` (server-only, owner-read) | `appwrite/schema/index.ts`, `policy.ts` `pushSubscriptionPermissions` |
| Device routes: on, switches, off, test | `app/api/push/route.ts`, `app/api/push/test/route.ts`, `appwrite/documents/push-admin.ts` |
| Event filter, recipients, freshness | `lib/push/notify-event.ts` |
| One event to messages to devices | `lib/push/dispatch.ts`, `lib/push/deliver.ts` |
| The Function | `functions/notify/src/main.ts`, spec in `appwrite/functions/index.ts` |
| Fetch-based TablesDB for the Function | `appwrite/documents/rest-tables.ts` |
| Service worker: `push`, `notificationclick`, collapse | bottom of `public/sw.js` |
| Settings UI (coach only) | `components/profile/notification-settings.tsx`, on Me |

## Collapse

Six clips from one session make **one** notification per athlete, reading
"Joey uploaded 6 clips", opening the review queue. Mechanism: every message
carries a `tag` (`clips:<athleteId>` or `replies:<athleteId>`) and a `key`
(`<setId>:<videoFileId>` or the comment id). The service worker reads the
notification already showing under that tag, adds the key to the ones it
stands for, and re-shows it with the count. A new key sets `renotify: true`
(buzz); a key already in it replaces quietly. That second case is what absorbs
duplicate events: both event spellings firing, or the poster update landing a
moment after the clip.

[Inference] Counting on the device rather than the server is the better
number: it is "new since you last looked", because a dismissed notification
starts the count again. There is no server-side debounce; if Ruairi finds six
buzzes in a minute too many, a per-tag cooldown in the Function is the next
step.

Safari ignores `renotify`, so on iPhone a collapsed update replaces silently
after the first buzz. [Unverified] on a real device.

## Deep links

- One clip: `/coach/athletes/<athleteId>?clip=<setId>`, the existing clip and
  thread panel (`lib/coach/athlete-panel.ts`). Several: `/coach/review`.
- A reply: `COACH_THREAD_ROUTE` in `lib/push/links.ts`, F26's
  `/coach/replies/<setId>` (PR #132), which marks the thread read and
  redirects to the clip panel. That route only exists once #132 merges, so
  F27 must merge after it.

Payload URLs are paths, resolved by the worker against its own origin; the
worker refuses anything that is not a same-origin absolute path.

## Detecting "the clip is new" on an update

The event payload is the row after the write, with nothing about before. So
for a set **update**, the Function reads the clip file's `$createdAt` from
Storage and notifies only if it is under 10 minutes old (`CLIP_FRESH_MS`).
`attachVideo` runs as the upload finishes, so a real attach is seconds after
the file. Limits, all [Inference]:

- An unrelated edit to the set within 10 minutes of the upload re-sends; the
  key is the same, so the worker replaces quietly. No extra buzz.
- An upload whose attach is delayed past 10 minutes (finalise stuck offline
  and retried later) does not notify. The clip is still in the queue.
- The worker that makes proxies (`clips:proxies`) updates sets with the API
  key; if it runs within 10 minutes of an upload, same as the first case.

## Security notes

- The table has no table-level create: only `/api/push` writes it, user from
  the JWT. Otherwise a session could register its own browser under a coach's
  `user_id` and read athlete names off their notifications.
- Endpoints must be https on a known push service (FCM, Mozilla, Apple, WNS;
  `isPushEndpoint`), because the Function POSTs to them from the homelab
  network. An open list would be a request-forgery primitive.
- One device is one row: the row id is derived from sha256 of the endpoint,
  and `endpoint_hash` is unique-indexed (a 1024-character unique index is past
  what MariaDB keys in full). A device another account registered is handed
  over to whoever subscribes on it next.
- 404/410 from a push service deletes the row (`outcomeFor`); other failures
  keep it and leave `last_success_at` stale.
- Sign-out removes this device's row and unsubscribes it, bounded at 3s.
- Lock-screen text includes the athlete's name and up to 140 characters of
  their reply. [SME to confirm] whether Ruairi wants reply text hidden.

## Environment variables

Names only. Never commit a value.

| Name | Where | What |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel (all envs), the Function, the deploy shell | VAPID public key. Public by design; inlined into the browser bundle, so a change needs a redeploy |
| `VAPID_PRIVATE_KEY` | Vercel (server), the Function, the deploy shell | **Secret** |
| `VAPID_SUBJECT` | Vercel, the Function, the deploy shell | `mailto:` contact the push services can reach, e.g. Joey's address |

The Function gets them from `npm run appwrite:functions`, which copies each
name in the spec's `secrets` from the deploying shell's environment into a
**secret** Function variable, prints names only, and refuses to deploy
`notify` if one is missing. Keys must match on Vercel and the Function: a
subscription made with one public key cannot be sent to with another.

`NOTIFY_DRY_RUN` is a plain Function variable (spec), default `false`.
`true` classifies and logs, sends and writes nothing.

## Rollout runbook (Joey)

1. **Generate keys once**, on a trusted machine: `npx web-push generate-vapid-keys`.
   It prints a public and a private key. Do not paste them anywhere that logs.
2. **Store them** wherever `~/personal/snb-ops/with-snb-env.sh` gets the
   instance secrets from (beside `APPWRITE_API_KEY`), as
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, so the
   deploy shell has them. [Unverified] how that script stores them; it lives
   outside this repo.
3. **Vercel**: add all three to Production (and Preview if previews should
   push). Redeploy after, because the public one is inlined at build time.
4. **Schema**: merge order is F26 (v24), F28, then this (v25). Then
   `with-snb-env.sh npm run appwrite:setup` applies `push_subscriptions`. New
   table only; rewrites no row.
5. **Function**: `with-snb-env.sh npm run appwrite:functions -- --dry-run`,
   check `notify` shows the three secrets as present and the six events, then
   without `--dry-run`. Optionally set `NOTIFY_DRY_RUN=true` first and watch
   the executions log a set upload.
6. **Prod deploy** (Vercel) with the keys set.
7. **Audit**: `with-snb-env.sh npm run appwrite:audit`. It now covers
   `push_subscriptions` (owner read only, no session writes) and checks both
   Functions are deployed.
8. **Test on iPhone** (iOS 16.4+): open the site in Safari, Share, Add to
   Home Screen, open it from the icon, sign in as a coach, Me, Notifications,
   Turn on notifications, Allow. Tap Send a test: it should appear within
   seconds, also with the app closed. Then as a linked athlete on another
   device, attach a clip to a set and reply to a coach comment; expect
   "<name> uploaded a clip" and "<name> replied", and a tap to land on the
   clip panel. Upload two more clips: one notification, "uploaded 3 clips".
   On a Mac or Android, the same from Chrome.

## Not done

- No server-side debounce (see Collapse).
- Athletes get no notifications; nothing in the ask needs one.
- [Unverified] on a real device and on the live instance: everything above is
  unit-tested, nothing has run against a push service.
