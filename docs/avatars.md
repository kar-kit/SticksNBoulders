# Profile pictures

Joey, 7 Oct 2026: *"Profile pictures for both coaches and athletes."*

A coach scanning a rail of eight first names recognises faces faster than
names, and the welcome screen (docs/onboarding.md) is the natural moment to ask
for one. Optional everywhere: no picture means initials, and nothing waits on
one.

## Storage

**Bucket `avatars`**, schema v13, declared in `appwrite/schema` like
`set_videos`:

| | |
| --- | --- |
| File security | per file, no bucket-level read |
| Bucket permission | `create("users")` only |
| Max size | 2MB |
| Extensions | `webp`, `jpg`, `jpeg` |
| Compression | none (already compressed) |
| Encryption | **on**, unlike clips |
| Antivirus | off (no ClamAV on the instance) |

Encryption is on here and off for clips for one reason: Appwrite skips
encryption above 20MB, so for clips the guarantee would hold only for short
ones. This bucket refuses anything over 2MB, so every file is covered.

**Column `profiles.avatar_file_id`**, string 36, nullable, no index. Null is
every profile written before v13, so it needs no backfill.

## Who sees a picture, and why

`avatarPermissions` in `appwrite/documents/policy.ts`:

- **Owner**: read, update, delete.
- **Owner's circle**: read. A linked coach is in the athlete's circle, so the
  coach sees the athlete's face in the rail, roster, review queue and Athlete
  View.
- **Nobody else.** No `read("users")`: that is the stamp a stranger would make,
  the audit treats it as squattable, and a face is the most identifying thing
  the product stores.

This is the profile row's audience exactly, on purpose: the row and the file
it names should never disagree about who may see them.

**The other direction.** An athlete is not in their coach's circle, which is
why they cannot read the coach's profile row and why the coach's name already
comes through `/api/link/coach`. The coach's picture follows the same path:
`/api/link/coach/avatar` takes the athlete from the JWT, finds their active
link, reads the coach's authentic profile and streams that file with the API
key. No parameter names a file or a user. The alternatives were worse:
`read("users")` on every coach's picture, or re-stamping a coach's file every
time a link changes, which is drift waiting to happen (the reason circle teams
exist at all; `appwrite/documents/circle.ts`).

### A profile pointing at somebody else's picture

The profile row is written only by its owner (provenance.ts), but the row alone
cannot prove the file is theirs. Athlete A could point their profile at athlete
B's picture, and the coach they share would see B's face beside A's name.

So the id carries its owner: every picture is uploaded at
`<userId>_<8 lowercase letters or digits>` (`appwrite/documents/avatar.ts`),
and every reader goes through `avatarOf`, which accepts an id only inside the
row's own user's namespace. That check is pure, with no request per face. The
write helper (`setProfileAvatar`) refuses a foreign id as well, so the app never
writes a row a reader will distrust.

The validate-row Function's verdict is deliberately unchanged: it **keeps**
such a row and logs why. Its owner wrote it, and deleting an honest profile
(name, sex, units) to remove a cosmetic field is the wrong trade when readers
already show initials. Squats are still deleted exactly as before.

## Preparing a picture

In the browser, before upload (`lib/profile/avatar.ts`):

1. Decode with `createImageBitmap(file, { imageOrientation: "from-image" })`,
   so a portrait phone photo stored landscape with an EXIF flag comes out
   upright.
2. Crop the largest centred square, in whole pixels.
3. Draw into a 512x512 canvas and encode WebP at 0.85. If the browser returns
   anything other than WebP (Safari before 17 hands back PNG), encode JPEG.
4. Refuse anything still over 2MB. Real output is tens of kilobytes.

The preview on Me and on the welcome screen is the prepared file itself, so
what someone approves is what their coach sees.

## Upload, replace, remove

`lib/profile/avatar-store.ts`. Online only, refused in a sentence when offline;
a face is not worth a queue, and nothing else waits on it.

- **Replace** is upload new, repoint the profile, delete the old file, in that
  order, so the profile never points at nothing. If repointing fails, the new
  file is deleted and the old face stays. If deleting the old file fails, the
  new face stays and the old file is an orphan.
- **Remove** clears the column to null, then deletes the file.
- **Orphans** are reclaimed by `npm run clips:sweep`, which now reads
  `profiles.avatar_file_id` beside `sets.video_file_id` (docs/backups.md §6).

## Showing a picture

`components/ui/avatar.tsx`: initials always rendered, the picture laid over
them, fixed width and height so nothing shifts, `loading="lazy"`, alt text the
person's name.

**Not an `<img src>` pointed at Appwrite.** The session is a cookie on
Appwrite's origin, which the browser treats as third-party and does not send
from the app's origin (lib/video/ticket.ts found the same for clips), and an
`<img>` cannot carry the header the SDK authenticates with. So the bytes come
through the SDK's own request (`client.call`, the same path every row read
uses) and are shown from a blob URL. Clips needed signed tickets because a
`<video>` streams with range requests the page cannot make itself; a picture is
one small GET, so it needs no ticket, no route and no secret. Appwrite applies
the file's own permissions to the session.

`getFileView`, not `getFilePreview`: the file is already the 512px square, and
a preview asks the server to transform an image that needs nothing (and is a
metered feature on Appwrite Cloud).

**No extra profile reads.** `fetchAthleteNames` already reads every athlete's
profile for the rail, roster and queue; it now selects `avatar_file_id` too and
feeds a registry keyed by user id (`lib/profile/avatar-cache.ts`). Your own id
arrives through `fetchProfile`. Each image is one request, cached per page load
by file id.

## Known limits

- **HEIC on desktop.** Chrome, Firefox and Edge cannot decode HEIC, so a file
  AirDropped from an iPhone to a laptop is refused with a plain message. On the
  phone itself iOS converts to JPEG when the photo is picked.
- **No crop control.** The square is always centred. Fine for a selfie; an
  off-centre face gets cut. Worth revisiting if anyone complains.
- **Anyone signed in can upload into the bucket**, as with clips. Nothing
  points at such a file unless its owner's profile does, so it is a storage
  cost, not exposure, and the sweep reclaims it.
- **A user id over 27 characters** cannot get a picture id (36-character
  Appwrite limit). Generated ids are 20; only hand-made ones hit this.
- **Coach picture for athletes** is fetched once per Me visit, uncached by the
  browser (`no-store`), because it must stop the moment the link ends.

## Files

| File | What it holds |
| --- | --- |
| `appwrite/documents/avatar.ts` | Id namespace, `avatarOf` |
| `appwrite/documents/policy.ts` | `avatarPermissions` |
| `appwrite/documents/link-admin.ts` | `coachPictureFor` |
| `app/api/link/coach/avatar/route.ts` | The coach's picture, for their athlete |
| `lib/profile/avatar.ts` | Crop, resize, encode |
| `lib/profile/avatar-store.ts` | Upload, replace, remove |
| `lib/profile/avatar-cache.ts` | Registry and image cache |
| `components/ui/avatar.tsx`, `components/profile/*` | Display and the Photo row |
