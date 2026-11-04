/**
 * Push subscriptions (F27): what a stored one may look like.
 *
 * Pure, and free of node:crypto, so the write helper (which the browser
 * bundles) can import it. The row id derivation needs a hash and lives
 * server-side in push-admin.ts.
 */

export const PUSH_TABLE = "push_subscriptions";

/** Matches the column. Real endpoints are 150-300 characters. */
export const PUSH_ENDPOINT_MAX = 1024;
export const PUSH_LABEL_MAX = 64;

/**
 * The push services browsers actually hand out endpoints on. [Fact] for the
 * three that matter here, from the endpoints each browser returns:
 * Chrome/Edge on Android and Chrome on desktop use FCM, Firefox uses
 * Mozilla's autopush, Safari on macOS and iOS 16.4+ uses Apple's. Edge on
 * Windows uses WNS. [Inference] that nothing else is worth allowing: a
 * browser outside this list cannot subscribe, which is a missing feature,
 * where an open list is a server that POSTs wherever a session tells it to.
 */
const PUSH_HOSTS: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
];

/** An https URL on a known push service, short enough for the column. */
export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The subscription's P-256 public key: 65 bytes, base64url. */
export function isP256dh(value: unknown): value is string {
  return typeof value === "string" && value.length >= 86 && value.length <= 90 && BASE64URL.test(value);
}

/** The subscription's auth secret: 16 bytes, base64url. */
export function isPushAuth(value: unknown): value is string {
  return typeof value === "string" && value.length >= 22 && value.length <= 24 && BASE64URL.test(value);
}

/** Which kinds of notification a device gets. Both on unless the coach says otherwise. */
export interface PushPrefs {
  clips: boolean;
  replies: boolean;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = { clips: true, replies: true };

/** Prefs off a stored row. A missing column reads as on, matching the schema default. */
export function prefsOf(row: Record<string, unknown>): PushPrefs {
  return { clips: row.notify_clips !== false, replies: row.notify_replies !== false };
}
