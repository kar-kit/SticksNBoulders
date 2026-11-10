import { isAuthentic } from "@/appwrite/documents/provenance";
import type { OwnerReader } from "@/appwrite/documents/api-reader";
import { profileFromRow, type Profile, type ProfileRow } from "@/lib/profile/profile";

/**
 * What every /api/v1 endpoint is handed once the token has been checked
 * (F29). `tables` reads as the token's owner, on a JWT minted for them, so
 * Appwrite's row permissions apply to every read; there is no API key in it.
 *
 * The endpoints narrow to the owner's own rows on top of that: a coach's JWT
 * can read their athletes' sessions through the circle, and this API is
 * for a person's own data. Appwrite stops strangers; the owner filter stops
 * a coach's token reading anyone else's training.
 */
export interface ReadContext {
  tables: OwnerReader;
  databaseId: string;
  ownerId: string;
  now: Date;
  token: { id: string; label: string; expiresAt: string };
  account(): Promise<{ name: string; email: string }>;
  url: URL;
}

/** JSON and a status. The serving layer adds the headers and the audit line. */
export interface ApiResult {
  status: number;
  body: unknown;
}

export const ok = (body: unknown): ApiResult => ({ status: 200, body });
export const failure = (status: number, error: string): ApiResult => ({ status, body: { error } });
/** Missing, and somebody else's, look the same: the API never confirms an id exists. */
export const notFound = (): ApiResult => failure(404, "not_found");

/** Appwrite's ids: up to 36 of a-z, A-Z, 0-9, ".", "-", "_", no leading special. */
export const isRowId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(value);

/** A row, or null when it is missing or this reader may not see it (Appwrite says 404 for both). */
export async function rowOrNull(ctx: ReadContext, tableId: string, rowId: string) {
  if (!isRowId(rowId)) return null;
  try {
    return await ctx.tables.getRow({ databaseId: ctx.databaseId, tableId, rowId });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 404 || code === 401 || code === 403) return null;
    throw error;
  }
}

/**
 * The owner's profile, read as the owner, only if the owner wrote it -- the
 * same rule as profile-store.ts. Null for none, which reads as kilograms.
 */
export async function ownProfile(ctx: ReadContext): Promise<Profile | null> {
  const row = await rowOrNull(ctx, "profiles", ctx.ownerId);
  if (!row || !isAuthentic("profiles", row)) return null;
  return profileFromRow(row as unknown as ProfileRow);
}
