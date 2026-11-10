/**
 * Personal access tokens for the read API (F29): what a stored one may look
 * like, and the rules a token lives by.
 *
 * Pure, and free of node:crypto, so the write helper (which the browser
 * bundles) can import it. Minting and hashing need crypto and live
 * server-side in api-token-admin.ts.
 */

export const API_TOKENS_TABLE = "api_tokens";
export const API_REQUESTS_TABLE = "api_requests";

/**
 * Every token starts with this. A token can then never be mistaken for an
 * Appwrite JWT, which `callerFrom` also takes as a Bearer header, and a
 * secret scanner can recognise one in a paste.
 */
export const TOKEN_PREFIX = "snb_pat_";

/** 32 random bytes, base64url without padding: 43 characters. */
export const TOKEN_BYTES = 32;
const TOKEN_SHAPE = /^snb_pat_[A-Za-z0-9_-]{43}$/;

export const API_TOKEN_LABEL_MAX = 64;
export const DEFAULT_EXPIRY_DAYS = 90;
export const MAX_EXPIRY_DAYS = 365;
/** Live tokens per user. Revoked and expired ones do not count. */
export const MAX_LIVE_TOKENS = 5;
/** v1 has one scope. */
export const API_SCOPE = "read";

/** Matches the `path` column. */
export const API_PATH_MAX = 512;

export function isTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/**
 * The token in an `Authorization: Bearer ...` header, or null.
 *
 * Only something shaped like one of ours. An Appwrite JWT, an empty header, a
 * token with a typo: all null, and all answered the same 401 as a revoked one.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const token = match?.[1] ?? "";
  return isTokenShape(token) ? token : null;
}

export type TokenState = "live" | "revoked" | "expired";

/**
 * Whether a stored token still opens anything. Revocation wins over expiry:
 * the list should say what the owner did, not what the clock did after.
 * An unreadable expiry is treated as expired, never as forever.
 */
export function tokenState(row: { revoked_at?: unknown; expires_at?: unknown }, now: Date): TokenState {
  if (typeof row.revoked_at === "string" && row.revoked_at) return "revoked";
  const expires = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : Number.NaN;
  if (!Number.isFinite(expires) || expires <= now.getTime()) return "expired";
  return "live";
}

/** When a token minted `now` for `days` days stops working. */
export function expiryFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The label as stored: trimmed, inner whitespace collapsed, cut to the
 * column. Null when nothing is left, which the route refuses.
 */
export function normaliseTokenLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/\s+/g, " ").trim().slice(0, API_TOKEN_LABEL_MAX).trim();
  return label ? label : null;
}
