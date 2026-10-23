"use client";

import { useEffect, useState } from "react";
import { browserAppwrite } from "@/appwrite/browser-client";
import { POSTER_BUCKET } from "@/appwrite/documents/poster";

/**
 * A clip's poster as something an `<img>` can show (F12).
 *
 * Fetched exactly as profile pictures are (lib/profile/avatar-cache.ts), and
 * for the same reason: the session is a cookie on Appwrite's origin that the
 * browser will not send from the app's, and an `<img>` cannot carry the header
 * the SDK authenticates with. So the bytes come through the SDK's own request
 * and are shown from a blob URL. Appwrite applies the file's own permissions,
 * which are the clip's -- a coach who can watch the clip sees its poster.
 *
 * Two differences from avatars, both because a queue can hold 300 clips:
 *   - at most MAX_PARALLEL downloads at once, the rest waiting their turn, so
 *     a long review rail never fires hundreds of requests together;
 *   - the component asks only once the thumbnail is near the screen
 *     (components/video/clip-thumb.tsx).
 *
 * Cached per poster id for the page's life. A failure is not cached and never
 * thrown: the placeholder is always there to fall back on.
 */

export const MAX_PARALLEL = 4;

const urls = new Map<string, Promise<string | null>>();
let running = 0;
const waiting: Array<() => void> = [];

async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function load(posterId: string): Promise<string | null> {
  const { client, storage } = browserAppwrite();
  // View, not preview: the file is already a 320px frame.
  const url = storage.getFileView({ bucketId: POSTER_BUCKET, fileId: posterId });
  const bytes = (await client.call("get", new URL(url), {}, {}, "arrayBuffer")) as ArrayBuffer;
  return URL.createObjectURL(new Blob([bytes]));
}

/** The poster's blob URL, or null when it cannot be had. Never throws. */
export function posterUrl(posterId: string): Promise<string | null> {
  let pending = urls.get(posterId);
  if (!pending) {
    pending = turn(() => load(posterId)).catch(() => {
      urls.delete(posterId);
      return null;
    });
    urls.set(posterId, pending);
  }
  return pending;
}

/** Null until loaded, and for no poster, a failed load, or `enabled` false. */
export function usePosterUrl(posterId: string | null, enabled = true): string | null {
  const [loaded, setLoaded] = useState<{ posterId: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!posterId || !enabled) return;
    let cancelled = false;
    void posterUrl(posterId).then((url) => {
      if (!cancelled) setLoaded({ posterId, url });
    });
    return () => {
      cancelled = true;
    };
  }, [posterId, enabled]);
  return posterId && loaded?.posterId === posterId ? loaded.url : null;
}

/** Sign-out: frames of someone's training must not outlive their session on a shared phone. */
export function forgetPosters(): void {
  for (const pending of urls.values()) {
    void pending.then((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }
  urls.clear();
}
