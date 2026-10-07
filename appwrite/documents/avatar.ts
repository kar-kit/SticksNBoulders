/**
 * Whose a profile picture is, from its id alone.
 *
 * A profile row is written only by its owner (provenance.ts), so the owner
 * alone decides what `avatar_file_id` says. What the row cannot prove is that
 * the file it names is the owner's own: athlete A could point their profile at
 * athlete B's picture, and the coach both share would see B's face beside A's
 * name.
 *
 * So the id carries its owner. Every picture is uploaded at
 * `<userId>_<8 lowercase letters or digits>`, and a reader accepts an
 * `avatar_file_id` only if it lies in the profile owner's own namespace. That
 * check is pure -- no request per picture to read the file's permissions --
 * which matters on a roster of eight. The suffix can never contain `_`, so no
 * user id is a prefix of another user's namespace by accident.
 *
 * A stranger can upload a file into somebody's namespace (the bucket grants
 * create to every signed-in user, as the clips bucket does), but nothing points
 * at it: the only row that can is the victim's profile, which only the victim
 * writes.
 *
 * Pure. No client, no network.
 */

export const AVATAR_BUCKET = "avatars";

/** Appwrite ids stop at 36 characters. */
const MAX_FILE_ID = 36;
const SUFFIX = /^[a-z0-9]{8}$/;

function randomSuffix(random: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/**
 * A fresh id for this user's next picture.
 *
 * New every time rather than one fixed id per user: replacing a picture is
 * upload, repoint, then delete the old one, and a fixed id would have to be
 * deleted first -- leaving them faceless if the upload then failed.
 *
 * Throws for a user id too long to leave room, like `bodyweightRowId`. A
 * generated Appwrite user id is 20 characters; only a hand-made one over 27
 * gets here, and it should fail loudly rather than as a rejected upload.
 */
export function newAvatarFileId(userId: string, random: () => number = Math.random): string {
  if (!userId) throw new Error("newAvatarFileId: userId is required");
  const id = `${userId}_${randomSuffix(random)}`;
  if (id.length > MAX_FILE_ID) {
    throw new Error(`newAvatarFileId: "${id}" exceeds Appwrite's ${MAX_FILE_ID}-character limit`);
  }
  return id;
}

/** Whether `fileId` is a picture id inside `userId`'s namespace. */
export function isOwnAvatarFileId(userId: string, fileId: unknown): fileId is string {
  if (!userId || typeof fileId !== "string") return false;
  const prefix = `${userId}_`;
  return fileId.startsWith(prefix) && SUFFIX.test(fileId.slice(prefix.length));
}

/**
 * The picture a profile row may be shown with, or null.
 *
 * The one place a reader turns `avatar_file_id` into something to display.
 * Absent, blank, or outside the owner's namespace all read as no picture: the
 * initials are always a safe thing to show, and somebody else's face is not.
 */
export function avatarOf(row: Record<string, unknown>): string | null {
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const fileId = row.avatar_file_id;
  return isOwnAvatarFileId(userId, fileId) ? fileId : null;
}
