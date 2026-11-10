import { NextResponse } from "next/server";
import { ID } from "node-appwrite";
import { serverAppwriteConfig } from "@/appwrite/env";
import { createServerClient } from "@/appwrite/server-client";
import { API_PATH_MAX, bearerToken } from "@/appwrite/documents/api-token";
import { adminApiTokenTables, recordCall, verifyToken, type VerifyResult } from "@/appwrite/documents/api-token-admin";
import { mintOwnerJwt, ownerView } from "@/appwrite/documents/api-reader";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { failure, type ApiResult, type ReadContext } from "./context";

/**
 * Every /api/v1 request goes through here (F29).
 *
 *   1. The method. Anything but GET is 405, whatever the token.
 *   2. The token, by its hash. Unknown, revoked and expired all get the same
 *      401 with the same body, so the API never says which.
 *   3. The rate limit, per token.
 *   4. A 60-second JWT for the token's owner, and the endpoint, reading
 *      through that JWT with no API key (appwrite/documents/api-reader.ts).
 *   5. One audit row and `last_used_at`, for every call made with a token we
 *      issued -- refused, limited and failed calls included. A failed audit
 *      write is logged and the answer still goes out.
 *
 * A call with no token, or one we never issued, has nobody to attribute it
 * to and writes no row: an unauthenticated caller must not be able to grow a
 * table. [Inference] The trail is "what was done with my tokens", which those
 * calls are not.
 */

export const API_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/**
 * In memory, so per Vercel instance: a soft cap, and two warm instances
 * would allow 120 a minute between them. [Inference] Fine for one user's
 * token, where the limit is there to stop a runaway script, not an attacker;
 * a shared store is the change if tokens ever go to other athletes. The same
 * trade the sign-in method hint makes (lib/auth/rate-limit.ts).
 */
const limiter = createRateLimiter(API_RATE_LIMIT);
const SWEEP_ABOVE = 1000;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UNAUTHORIZED = failure(401, "unauthorized");

export type Endpoint = (ctx: ReadContext) => Promise<ApiResult>;

/** The path and only the parameters the endpoint accepts, each value capped: what the audit row keeps. */
export function auditPath(url: URL, allowed: readonly string[]): string {
  const kept = new URLSearchParams();
  for (const key of allowed) {
    const value = url.searchParams.get(key);
    if (value !== null) kept.set(key, value.slice(0, 64));
  }
  const query = kept.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`.slice(0, API_PATH_MAX);
}

function respond(result: ApiResult, headers: Record<string, string> = {}): Response {
  return NextResponse.json(result.body, { status: result.status, headers: { ...NO_STORE, ...headers } });
}

const attributable = (verified: VerifyResult) =>
  verified.status === "live"
    ? { tokenId: verified.token.tokenId, ownerId: verified.token.ownerId }
    : verified.status === "refused"
      ? { tokenId: verified.tokenId, ownerId: verified.ownerId }
      : null;

/**
 * Answers one request. `endpoint` is null for a method the API does not
 * take: the token is still checked, so a POST made with a real token is in
 * its owner's trail as a 405.
 */
export async function serve(request: Request, endpoint: Endpoint | null, params: readonly string[] = []): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const config = serverAppwriteConfig();
  const admin = createServerClient(config);
  const now = new Date();
  const base = { tables: adminApiTokenTables(admin), databaseId: config.databaseId, now: () => now, newId: () => ID.unique() };
  const path = auditPath(url, params);

  const token = bearerToken(request.headers.get("authorization"));
  let verified: VerifyResult = { status: "unknown" };
  if (token) {
    try {
      verified = await verifyToken(base, token);
    } catch (error) {
      // Nothing can be attributed without the lookup, so nothing is audited.
      console.error(`[api] token check failed for ${method} ${url.pathname}`, error);
      return respond(failure(500, "failed"));
    }
  }
  const who = attributable(verified);
  const finish = async (result: ApiResult, headers: Record<string, string> = {}) => {
    if (who) await recordCall(base, { ...who, method, path, status: result.status, touch: verified.status === "live" });
    return respond(result, headers);
  };

  if (!endpoint) return finish(failure(405, "method_not_allowed"), { Allow: "GET" });
  if (verified.status !== "live") return finish(UNAUTHORIZED, { "WWW-Authenticate": "Bearer" });

  if (limiter.size > SWEEP_ABOVE) limiter.sweep();
  const rate = limiter.check(verified.token.tokenId);
  if (!rate.allowed) return finish(failure(429, "rate_limited"), { "Retry-After": String(rate.retryAfterSeconds) });

  let result: ApiResult;
  try {
    const view = ownerView(config, await mintOwnerJwt(admin, verified.token.ownerId));
    result = await endpoint({
      tables: view.tables,
      account: view.account,
      databaseId: config.databaseId,
      ownerId: verified.token.ownerId,
      now,
      token: { id: verified.token.tokenId, label: verified.token.label, expiresAt: verified.token.expiresAt },
      url,
    });
  } catch (error) {
    console.error(`[api] ${method} ${url.pathname} failed for token ${verified.token.tokenId}`, error);
    result = failure(500, "failed");
  }
  return finish(result);
}

/** A GET endpoint, and a 405 for every other method a client might try. */
export function readEndpoint(endpoint: Endpoint, params: readonly string[] = []) {
  const refuse = (request: Request) => serve(request, null, params);
  return {
    GET: (request: Request) => serve(request, endpoint, params),
    POST: refuse,
    PUT: refuse,
    PATCH: refuse,
    DELETE: refuse,
  };
}
