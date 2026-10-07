"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { AVATAR_BUCKET } from "@/appwrite/documents/avatar";

/**
 * Who has which picture, and the picture itself, per page load.
 *
 * The first half is a registry fed by reads that already happen:
 * `fetchAthleteNames` reads every athlete's profile for the rail, the roster
 * and the queue, and `fetchProfile` reads your own. Both drop the picture id
 * in here on the way past, so a face costs no profile request of its own --
 * a roster of eight is not eight more round trips.
 *
 * The second half fetches the image. Not with an `<img src>` pointed at
 * Appwrite, and this is the finding worth keeping: the session is a cookie on
 * Appwrite's origin, which the browser treats as third-party and does not send
 * from the app's origin (lib/video/ticket.ts found the same for clips), and an
 * `<img>` cannot carry the header the SDK authenticates with instead. So the
 * bytes come through the SDK's own request -- the same one every row read
 * uses -- and are shown from a blob URL.
 *
 * Clips needed signed tickets because a `<video>` streams with range requests
 * the page cannot intercept. A picture is one small GET the page can make
 * itself, so it needs no ticket, no route and no secret: Appwrite applies the
 * file's own permissions to the signed-in session, as it does for every row.
 */

const files = new Map<string, string | null>();
const listeners = new Set<() => void>();
let version = 0;

/** Records what profile reads said. Only notifies when something changed. */
export function rememberAvatars(entries: Iterable<readonly [string, string | null]>): void {
  let changed = false;
  for (const [userId, fileId] of entries) {
    if (!userId || files.get(userId) === fileId) continue;
    files.set(userId, fileId);
    changed = true;
  }
  if (!changed) return;
  version += 1;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The picture id for a user, or null when none is known. */
export function useAvatarFile(userId: string | null | undefined): string | null {
  useSyncExternalStore(subscribe, () => version, () => 0);
  return userId ? (files.get(userId) ?? null) : null;
}

const urls = new Map<string, Promise<string | null>>();

async function load(fileId: string): Promise<string | null> {
  const { client, storage } = browserAppwrite();
  // getFileView only builds the URL; the request is the SDK's, with its auth.
  // View rather than preview: the file is already the 512px square, and a
  // preview would ask the server to transform an image that needs nothing.
  const url = storage.getFileView({ bucketId: AVATAR_BUCKET, fileId });
  const bytes = (await client.call("get", new URL(url), {}, {}, "arrayBuffer")) as ArrayBuffer;
  return URL.createObjectURL(new Blob([bytes]));
}

/**
 * The picture as something an `<img>` can show, or null.
 *
 * Cached per file id for the page's life. A failure is not cached -- a coach
 * who opens the roster with no signal should get faces once it returns -- and
 * it is never thrown: the initials are always there to fall back on.
 */
export function avatarUrl(fileId: string): Promise<string | null> {
  let pending = urls.get(fileId);
  if (!pending) {
    pending = load(fileId).catch(() => {
      urls.delete(fileId);
      return null;
    });
    urls.set(fileId, pending);
  }
  return pending;
}

/** Seeds the cache with a picture this page just made, so it shows without a download. */
export function primeAvatarUrl(fileId: string, blob: Blob): void {
  urls.set(fileId, Promise.resolve(URL.createObjectURL(blob)));
}

export function useAvatarUrl(fileId: string | null): string | null {
  const [loaded, setLoaded] = useState<{ fileId: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    void avatarUrl(fileId).then((url) => {
      if (!cancelled) setLoaded({ fileId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return fileId && loaded?.fileId === fileId ? loaded.url : null;
}

/** Sign-out: the next person on this phone must not inherit faces, or ids. */
export function forgetAvatars(): void {
  for (const pending of urls.values()) {
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  urls.clear();
  files.clear();
  version += 1;
  for (const listener of listeners) listener();
}
