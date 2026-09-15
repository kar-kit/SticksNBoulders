import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived, single-file pass for a clip URL.
 *
 * It exists because of one thing a `<video>` element cannot do: send a header.
 * Appwrite will serve a circle-scoped clip to a coach's JWT, but only in
 * `x-appwrite-jwt`, and there is no query-param equivalent -- verified against
 * the instance, where `?jwt=` comes back 404. The session cookie does work,
 * and is a trap: the app and Appwrite are different origins, so the browser
 * treats it as third-party and will not send it from localhost at all.
 *
 * So the clip is served through this app's own origin, and this is how a plain
 * URL says who is asking.
 *
 * The ticket carries **identity, not authority**. It says "this URL was minted
 * for user U and file F before time T" and nothing else. The stream route then
 * asks Appwrite as that user, and Appwrite makes the access decision it would
 * have made anyway. Two consequences worth having:
 *
 *   - There is no permission logic here to get wrong. CLAUDE.md calls a missed
 *     permission path sev-1, and the way to never miss one is to not have one.
 *   - Revocation is honoured mid-stream. An athlete who unlinks leaves the
 *     circle team, and the coach's next range request 404s -- which is exactly
 *     what Order 16.6 asks the Review Queue to handle, arrived at for free.
 *
 * A ticket for a file the holder cannot read is therefore a perfectly valid
 * ticket that fetches nothing.
 */

/**
 * Five minutes. Long enough to start playing a clip and scrub through it,
 * short enough that a URL in a browser history or a proxy log is stale by the
 * time anyone reads it. The stream, once started, is not interrupted by
 * expiry -- this gates opening the file, not holding it.
 */
export const TICKET_TTL_MS = 5 * 60 * 1000;

export interface TicketClaims {
  fileId: string;
  userId: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * The signing key.
 *
 * Deliberately its own secret rather than something derived from the Appwrite
 * API key. A key that signs playback URLs and a key that can do anything to
 * the instance should not be the same value, and should be rotatable
 * independently.
 *
 * Throws rather than falling back. A missing secret must break the clip route
 * loudly in development, not quietly downgrade to unsigned URLs in production.
 */
export function ticketSecret(source: Record<string, string | undefined> = process.env): string {
  const secret = source.VIDEO_TICKET_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "VIDEO_TICKET_SECRET is missing or too short (32+ characters). Clip playback signs its URLs with it.",
    );
  }
  return secret;
}

export function mintTicket(claims: TicketClaims, secret: string): string {
  const payload = encode(JSON.stringify(claims));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * The claims, or null for anything that is not exactly right.
 *
 * One return for every failure -- malformed, re-signed, expired, truncated --
 * because the caller's response is the same in every case and a route that
 * explains which part of a token was wrong is a route that helps someone
 * guess the rest.
 */
export function readTicket(token: string, secret: string, now: number = Date.now()): TicketClaims | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload, secret), "base64url");
  // Length-checked first: timingSafeEqual throws on a mismatch rather than
  // returning false, and a thrown error here would be a 500 on a bad token.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let claims: TicketClaims;
  try {
    claims = JSON.parse(decode(payload)) as TicketClaims;
  } catch {
    return null;
  }

  if (typeof claims.fileId !== "string" || !claims.fileId) return null;
  if (typeof claims.userId !== "string" || !claims.userId) return null;
  if (typeof claims.expiresAt !== "number" || !Number.isFinite(claims.expiresAt)) return null;
  if (claims.expiresAt <= now) return null;

  return claims;
}

/** The URL a `<video>` element loads. Relative, because it is this app's own. */
export function clipUrl(fileId: string, ticket: string): string {
  return `/api/clip/${encodeURIComponent(fileId)}?t=${encodeURIComponent(ticket)}`;
}
