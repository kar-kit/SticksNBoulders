/**
 * A clip to play: its id, or its id and the proxy its row names (v22).
 *
 * A bare id is a clip with no proxy, so a screen whose rows have none sends
 * `POST /api/clip` exactly what it sent before proxies existed. The key of
 * every playback URL stays the clip id either way (lib/review/queue-store.ts
 * `fetchClipUrls`), so no screen has to know which file it got.
 *
 * Its own module, and pure, so a screen test that mocks the store still gets
 * the real thing.
 */
export type ClipSource = string | { fileId: string; proxyId?: string | null };

/** The source for a clip, bare when there is no proxy. */
export const clipSource = (fileId: string, proxyId?: string | null): ClipSource =>
  proxyId ? { fileId, proxyId } : fileId;
