import { NextResponse } from "next/server";
import { MAX_LIVE_TOKENS } from "@/appwrite/documents/api-token";
import { listTokens, mintToken } from "@/appwrite/documents/api-token-admin";
import { gate, NO_STORE } from "./gate";

/**
 * F29: a user's personal access tokens for the read API.
 *
 *   GET                              the caller's tokens, never their hashes
 *   POST { label, expiresInDays? }   a new token; the plaintext is in this
 *                                    response and nowhere else, ever
 *
 * DELETE /api/tokens/:id revokes (./[id]/route.ts). All three are for the
 * allowlisted only (API_TOKEN_USER_IDS); see docs/read-api.md.
 */

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await gate(request);
  if (!access.ok) return access.response;
  try {
    return NextResponse.json({ tokens: await listTokens(access.ctx), maxLive: MAX_LIVE_TOKENS }, { headers: NO_STORE });
  } catch (error) {
    console.error("[api-tokens] list failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request) {
  const access = await gate(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await mintToken(access.ctx, body);
    if (result.status === "invalid") {
      return NextResponse.json({ error: "invalid", reason: result.reason }, { status: 400, headers: NO_STORE });
    }
    if (result.status === "limit") {
      return NextResponse.json({ error: "token_limit", maxLive: MAX_LIVE_TOKENS }, { status: 409, headers: NO_STORE });
    }
    return NextResponse.json(
      { id: result.id, token: result.token, expiresAt: result.expiresAt, label: result.view.label },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    // Never the body: it holds nothing secret yet, but this is the route that
    // will, and a habit of logging bodies here is the leak waiting to happen.
    console.error("[api-tokens] mint failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
