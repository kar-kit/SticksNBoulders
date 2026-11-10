import { z } from "zod";

/**
 * Who may mint read API tokens (F29): the user ids in `API_TOKEN_USER_IDS`,
 * comma-separated. Joey only, for now. Opening it to everyone later is
 * deleting the check in /api/tokens; nothing in the schema depends on it.
 *
 * Read on every call rather than at module load, so the audit and the e2e
 * script can set it for their throwaway users without a restart, and so a
 * Vercel env change takes effect on the next cold start without a code change.
 *
 * Unset or empty means nobody. A value with an entry that is not an Appwrite
 * user id fails closed -- nobody -- and says why in the log, rather than
 * quietly allowing the entries it could parse: a typo in an allowlist is a
 * misconfiguration to fix, not something to guess around.
 */

export const API_TOKEN_USER_IDS = "API_TOKEN_USER_IDS";

/** Appwrite's id rule: up to 36 of a-z, A-Z, 0-9, period, hyphen, underscore; no leading special. */
const userId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/);

export type AllowlistResult = { ok: true; ids: ReadonlySet<string> } | { ok: false; problem: string };

export function parseAllowlist(raw: string | undefined): AllowlistResult {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const bad = entries.filter((entry) => !userId.safeParse(entry).success);
  if (bad.length > 0) {
    return { ok: false, problem: `${API_TOKEN_USER_IDS} has ${bad.length} entr${bad.length === 1 ? "y" : "ies"} that are not user ids` };
  }
  return { ok: true, ids: new Set(entries) };
}

let warned = false;

/** Whether this user may mint and hold tokens. */
export function mayUseApiTokens(callerId: string, env: Record<string, string | undefined> = process.env): boolean {
  const parsed = parseAllowlist(env[API_TOKEN_USER_IDS]);
  if (!parsed.ok) {
    // Once per instance: the value never changes while it runs. Names the
    // problem, never the value.
    if (!warned) console.error(`[api-tokens] ${parsed.problem}; nobody may mint tokens until it is fixed`);
    warned = true;
    return false;
  }
  return parsed.ids.has(callerId);
}
