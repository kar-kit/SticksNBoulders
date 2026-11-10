/**
 * Me, Connections (F29): the words on a token row. Pure, so the screen only
 * draws.
 */

export type TokenStateName = "live" | "revoked" | "expired";

/** A token as GET /api/tokens returns it. Never the hash, never the token. */
export interface TokenSummary {
  id: string;
  label: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  state: TokenStateName;
}

/** The lifetimes offered, in days. 90 is the default; 365 the server's ceiling. */
export const EXPIRY_CHOICES = [30, 90, 180, 365] as const;
export const DEFAULT_EXPIRY_CHOICE = 90;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8 Feb 2027", in the phone's own time zone. Empty for a date it cannot read. */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export const stateLabel = (state: TokenStateName): string =>
  state === "live" ? "Active" : state === "revoked" ? "Revoked" : "Expired";

/** "Created 10 Nov 2026 · Expires 8 Feb 2027", or what ended it. */
export function datesLine(token: TokenSummary): string {
  const created = `Created ${shortDate(token.createdAt)}`;
  if (token.state === "revoked") return `${created} · Revoked ${shortDate(token.revokedAt)}`;
  if (token.state === "expired") return `${created} · Expired ${shortDate(token.expiresAt)}`;
  return `${created} · Expires ${shortDate(token.expiresAt)}`;
}

export const lastUsedLine = (token: TokenSummary): string =>
  token.lastUsedAt ? `Last used ${shortDate(token.lastUsedAt)}` : "Never used";

/** Live first, then newest: the ones that still open something are what the owner is here about. */
export function orderTokens(tokens: readonly TokenSummary[]): TokenSummary[] {
  return [...tokens].sort(
    (a, b) => Number(b.state === "live") - Number(a.state === "live") || b.createdAt.localeCompare(a.createdAt),
  );
}

export const liveCount = (tokens: readonly TokenSummary[]): number => tokens.filter((t) => t.state === "live").length;
