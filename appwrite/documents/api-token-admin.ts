import { createHash, randomBytes } from "node:crypto";
import { Client, Query, TablesDB } from "node-appwrite";
import { z } from "zod";
import {
  API_TOKENS_TABLE,
  DEFAULT_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  MAX_LIVE_TOKENS,
  TOKEN_BYTES,
  TOKEN_PREFIX,
  expiryFrom,
  isTokenShape,
  normaliseTokenLabel,
  tokenState,
  type TokenState,
} from "./api-token";
import type { RowWriter } from "./row-writer";
import { createApiToken, recordApiRequest, revokeApiToken, touchApiToken, type WriteDeps } from "./write";

/**
 * /api/tokens and the token check behind /api/v1, server side (F29).
 *
 * Everything here runs with the API key, because `api_tokens` and
 * `api_requests` grant no session anything (policy.ts). The caller is
 * whoever the JWT says (minting, listing, revoking) or whoever a verified
 * token belongs to (the API). Never an id from a body.
 *
 * The token itself exists in exactly two places: the POST response that
 * hands it over, and wherever its owner puts it. This module hashes it on
 * the way in and never logs it.
 */

export interface ApiTokenTables {
  listRows(params: { databaseId: string; tableId: string; queries: string[] }): Promise<{ rows: Array<Record<string, unknown>> }>;
  writer: RowWriter;
}

export function adminApiTokenTables(client: Client): ApiTokenTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) => db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

/** A new token: the prefix and 32 random bytes, base64url, unpadded. */
export function generateToken(random: (size: number) => Buffer = randomBytes): string {
  const token = `${TOKEN_PREFIX}${random(TOKEN_BYTES).toString("base64url")}`;
  if (!isTokenShape(token)) throw new Error("generateToken: produced a malformed token");
  return token;
}

/** sha256 hex. What is stored and looked up; the token never is. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface Ctx {
  tables: ApiTokenTables;
  databaseId: string;
  callerId: string;
  now: () => Date;
  newId: () => string;
}

const writeDeps = (ctx: Pick<Ctx, "tables" | "databaseId" | "now" | "newId">): WriteDeps => ({
  writer: ctx.tables.writer,
  databaseId: ctx.databaseId,
  newId: ctx.newId,
  now: ctx.now,
});

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** A token as its owner sees it: never the hash. */
export interface TokenView {
  id: string;
  label: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  state: TokenState;
}

function viewOf(row: Record<string, unknown>, now: Date): TokenView {
  return {
    id: String(row.$id),
    label: String(row.label ?? ""),
    scope: String(row.scope ?? "read"),
    createdAt: String(row.created_at ?? ""),
    expiresAt: String(row.expires_at ?? ""),
    lastUsedAt: str(row.last_used_at),
    revokedAt: str(row.revoked_at),
    state: tokenState(row, now),
  };
}

/** Every token this user has, newest first, revoked and expired ones included. */
async function rowsOf(ctx: Ctx) {
  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: API_TOKENS_TABLE,
    // The cap is 5 live ones; the rest are history. 100 is room for years of
    // rotating a token every 90 days.
    queries: [Query.equal("owner_id", ctx.callerId), Query.orderDesc("created_at"), Query.limit(100)],
  });
  // A filter is a claim; checking the column is cheap.
  return page.rows.filter((row) => row.owner_id === ctx.callerId);
}

export async function listTokens(ctx: Ctx): Promise<TokenView[]> {
  const now = ctx.now();
  return (await rowsOf(ctx)).map((row) => viewOf(row, now));
}

const MintBody = z.object({
  label: z.string(),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).optional(),
});

export type MintResult =
  | { status: "invalid"; reason: string }
  | { status: "limit" }
  | { status: "minted"; id: string; token: string; expiresAt: string; view: TokenView };

/**
 * A new token for the caller. The plaintext is in this result and nowhere
 * else, ever: the route returns it once and it is gone.
 */
export async function mintToken(ctx: Ctx, body: unknown, random?: (size: number) => Buffer): Promise<MintResult> {
  const parsed = MintBody.safeParse(body);
  if (!parsed.success) return { status: "invalid", reason: `expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}` };
  const label = normaliseTokenLabel(parsed.data.label);
  if (!label) return { status: "invalid", reason: "A label is required" };

  const now = ctx.now();
  const live = (await rowsOf(ctx)).filter((row) => tokenState(row, now) === "live");
  if (live.length >= MAX_LIVE_TOKENS) return { status: "limit" };

  const token = generateToken(random);
  const rowId = ctx.newId();
  const expiresAt = expiryFrom(now, parsed.data.expiresInDays ?? DEFAULT_EXPIRY_DAYS);
  const row = await createApiToken(
    writeDeps({ ...ctx, now: () => now }),
    { userId: ctx.callerId },
    { rowId, tokenHash: hashToken(token), label, expiresAt },
  );
  const view = viewOf({ ...(row as Record<string, unknown>), $id: rowId, owner_id: ctx.callerId, label, scope: "read", created_at: now.toISOString(), expires_at: expiresAt.toISOString() }, now);
  return { status: "minted", id: rowId, token, expiresAt: expiresAt.toISOString(), view };
}

export type RevokeResult = { status: "revoked" } | { status: "absent" };

/**
 * Revokes one of the caller's tokens. Someone else's, or one that does not
 * exist, is "absent" -- the same answer -- so the route can say 404 without
 * confirming that a token id belongs to anybody. Revoking twice is a no-op
 * that keeps the first time.
 */
export async function revokeToken(ctx: Ctx, tokenId: string): Promise<RevokeResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(tokenId)) return { status: "absent" };
  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: API_TOKENS_TABLE,
    queries: [Query.equal("$id", tokenId), Query.limit(1)],
  });
  const row = page.rows.find((r) => r.$id === tokenId);
  if (!row || row.owner_id !== ctx.callerId) return { status: "absent" };
  if (!str(row.revoked_at)) await revokeApiToken(writeDeps(ctx), { userId: ctx.callerId }, { rowId: tokenId });
  return { status: "revoked" };
}

/* -------------------------------------------------------------------------
 * The check behind /api/v1
 * ---------------------------------------------------------------------- */

export interface VerifiedToken {
  tokenId: string;
  ownerId: string;
  label: string;
  expiresAt: string;
}

export type VerifyResult =
  | { status: "live"; token: VerifiedToken }
  /** A token we hold that no longer opens anything. Still audited: it is somebody's. */
  | { status: "refused"; reason: "revoked" | "expired"; tokenId: string; ownerId: string }
  /** Not a token we have ever issued. Nobody to attribute it to. */
  | { status: "unknown" };

/** One indexed lookup on the hash. Unknown, revoked and expired all refuse; the route answers them alike. */
export async function verifyToken(
  ctx: Pick<Ctx, "tables" | "databaseId" | "now">,
  token: string,
): Promise<VerifyResult> {
  if (!isTokenShape(token)) return { status: "unknown" };
  const hash = hashToken(token);
  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: API_TOKENS_TABLE,
    queries: [Query.equal("token_hash", hash), Query.limit(1)],
  });
  const row = page.rows.find((r) => r.token_hash === hash);
  const ownerId = row ? str(row.owner_id) : null;
  if (!row || !ownerId) return { status: "unknown" };
  const state = tokenState(row, ctx.now());
  if (state !== "live") return { status: "refused", reason: state, tokenId: String(row.$id), ownerId };
  return {
    status: "live",
    token: { tokenId: String(row.$id), ownerId, label: String(row.label ?? ""), expiresAt: String(row.expires_at) },
  };
}

export interface CallRecord {
  tokenId: string;
  ownerId: string;
  method: string;
  path: string;
  status: number;
  /** False for a refused token: its last use is not this. */
  touch: boolean;
}

/**
 * The audit line, and "last used". Both are attempted; a failure is logged
 * and swallowed, because the caller has already been answered on its merits
 * and an audit outage must not turn reads into errors. The log line names
 * the token id and path, never the token.
 */
export async function recordCall(ctx: Pick<Ctx, "tables" | "databaseId" | "now" | "newId">, call: CallRecord): Promise<void> {
  const deps = writeDeps(ctx);
  const results = await Promise.allSettled([
    recordApiRequest(deps, call),
    call.touch ? touchApiToken(deps, { rowId: call.tokenId, ownerId: call.ownerId }) : Promise.resolve(null),
  ]);
  const [audit, touched] = results;
  if (audit.status === "rejected") {
    console.error(`[api] audit write failed for token ${call.tokenId} ${call.method} ${call.path} ${call.status}`, audit.reason);
  }
  if (touched.status === "rejected") console.error(`[api] last_used_at update failed for token ${call.tokenId}`, touched.reason);
}
