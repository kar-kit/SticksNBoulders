"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import type { TokenSummary } from "./connections";

/**
 * Me, Connections, browser side (F29). Every call goes to /api/tokens with a
 * short-lived Appwrite JWT; the token table is server-only, so there is no
 * direct read.
 *
 * The server decides who may see the screen at all: a 403 here is "not on
 * API_TOKEN_USER_IDS", and the screen and its row on Me stay hidden.
 */

export type TokenAccess = { allowed: false } | { allowed: true; tokens: TokenSummary[]; maxLive: number };

export interface MintedToken {
  id: string;
  /** The plaintext. Held in component state until the owner dismisses it; never stored. */
  token: string;
  expiresAt: string;
  label: string;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { jwt } = await browserAppwrite().account.createJWT();
  return fetch(path, {
    ...init,
    cache: "no-store",
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${jwt}` },
  });
}

export async function fetchTokenAccess(): Promise<TokenAccess> {
  const response = await call("/api/tokens");
  if (response.status === 403) return { allowed: false };
  if (!response.ok) throw new Error(`could not list tokens: ${response.status}`);
  const body = (await response.json()) as { tokens: TokenSummary[]; maxLive: number };
  return { allowed: true, tokens: body.tokens, maxLive: body.maxLive };
}

/**
 * Whether the signed-in user may use Connections, asked once per page load
 * per user: Me renders on every visit, and an Appwrite JWT per visit is a
 * cost for a row almost nobody sees. A failure is not cached.
 */
const access = new Map<string, Promise<boolean>>();
export function mayUseConnections(userId: string): Promise<boolean> {
  let known = access.get(userId);
  if (!known) {
    known = fetchTokenAccess().then((result) => result.allowed);
    known.catch(() => access.delete(userId));
    access.set(userId, known);
  }
  return known;
}

export async function mintToken(label: string, expiresInDays: number): Promise<MintedToken> {
  const response = await call("/api/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, expiresInDays }),
  });
  const body = (await response.json().catch(() => ({}))) as Partial<MintedToken> & { error?: string; reason?: string; maxLive?: number };
  if (response.status === 409) throw new Error(`You can have ${body.maxLive ?? 5} active tokens. Revoke one first.`);
  if (!response.ok || typeof body.token !== "string" || typeof body.id !== "string") {
    throw new Error(body.reason ?? "Couldn’t create a token. Try again.");
  }
  return { id: body.id, token: body.token, expiresAt: String(body.expiresAt), label: String(body.label ?? label) };
}

export async function revokeToken(id: string): Promise<void> {
  const response = await call(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`could not revoke: ${response.status}`);
}
