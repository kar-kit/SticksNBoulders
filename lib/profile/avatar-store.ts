"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import {
  AVATAR_BUCKET,
  avatarPermissions,
  newAvatarFileId,
  setProfileAvatar,
  type Actor,
} from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import { extensionFor, type AvatarType } from "./avatar";
import { primeAvatarUrl, rememberAvatars } from "./avatar-cache";
import { ensureMyProfile, fetchProfile, forgetProfile } from "./profile-store";

/**
 * Uploading, replacing and removing your own profile picture.
 *
 * Online only, said plainly. Unlike a set, a picture is not worth a queue: it
 * is a few seconds' job someone chose to do now, and holding a photo in
 * IndexedDB to retry later would be storing a face on the device for nothing.
 * Nothing else in the app waits on any of this.
 *
 * Replace is upload, repoint, then delete the old file -- in that order, so
 * there is never a moment the profile points at nothing. The delete is best
 * effort: if it fails, the old file is an orphan the sweep reclaims
 * (appwrite/backup/orphans.ts), and the person still has their new face.
 */

export class AvatarUnavailable extends Error {}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

async function whoAmI(): Promise<{ actor: Actor; previous: string | null }> {
  if (offline()) throw new AvatarUnavailable("You're offline. Adding a photo needs a connection.");
  const { account } = browserAppwrite();
  const user = await account.get();
  // The file carries a read for this user's circle, which Appwrite refuses
  // from a session outside the team; and the profile row has to exist to be
  // pointed at anything.
  await ensureMyCircle();
  await ensureMyProfile();
  // Read fresh rather than from the memo: another tab may have changed it,
  // and deleting what was there a minute ago could delete the current face.
  const profile = await fetchProfile(user.$id);
  return { actor: { userId: user.$id }, previous: profile?.avatarFileId ?? null };
}

async function deleteQuietly(fileId: string): Promise<void> {
  const { storage } = browserAppwrite();
  await storage.deleteFile({ bucketId: AVATAR_BUCKET, fileId }).catch(() => {});
}

/** Uploads a prepared picture and makes it theirs. Returns the new file id. */
export async function replaceMyAvatar(blob: Blob, type: AvatarType): Promise<string> {
  const { actor, previous } = await whoAmI();
  const { storage } = browserAppwrite();
  const fileId = newAvatarFileId(actor.userId);

  await storage.createFile({
    bucketId: AVATAR_BUCKET,
    fileId,
    file: new File([blob], `avatar.${extensionFor(type)}`, { type }),
    permissions: avatarPermissions({ userId: actor.userId }),
  });
  try {
    await setProfileAvatar(browserWriteDeps(() => actor.userId), actor, { fileId });
  } catch (error) {
    // Nothing points at the new file; take it back rather than leave it for
    // the sweep, and keep the old face exactly where it was.
    await deleteQuietly(fileId);
    throw error;
  }
  if (previous && previous !== fileId) await deleteQuietly(previous);

  primeAvatarUrl(fileId, blob);
  rememberAvatars([[actor.userId, fileId]]);
  forgetProfile();
  return fileId;
}

/** Back to initials. */
export async function removeMyAvatar(): Promise<void> {
  const { actor, previous } = await whoAmI();
  await setProfileAvatar(browserWriteDeps(() => actor.userId), actor, { fileId: null });
  if (previous) await deleteQuietly(previous);
  rememberAvatars([[actor.userId, null]]);
  forgetProfile();
}
