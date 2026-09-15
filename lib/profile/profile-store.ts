"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { createProfile, updateProfile, type Actor } from "@/appwrite/documents";
import {
  DEFAULT_UNITS,
  fallbackName,
  isSex,
  isUnits,
  type Profile,
  type Sex,
  type Units,
} from "./profile";

/**
 * Reading and writing the profile row.
 *
 * No server route, unlike the circle, and the difference is worth stating. A
 * profile's row id IS the user id and every permission on it names the owner,
 * so an athlete can only ever write their own -- Appwrite refuses a row stamped
 * for somebody else, which is the same rule that made a coach unable to stamp
 * an athlete's read at Order 17. Verified against the instance: an athlete
 * creating a profile under another user's id comes back refused.
 *
 * That is why this is safe where `reference_maxes` was not. There the forgeable
 * field was data the row merely claimed; here the thing being claimed is the
 * row's own id, and Appwrite polices that.
 */

interface ProfileRow {
  $id: string;
  user_id?: unknown;
  display_name?: unknown;
  sex?: unknown;
  units?: unknown;
}

function toProfile(raw: ProfileRow): Profile {
  return {
    userId: typeof raw.user_id === "string" ? raw.user_id : raw.$id,
    displayName: typeof raw.display_name === "string" ? raw.display_name : "",
    // Anything that is not one of the two known values reads as unanswered.
    // A profile carrying a third value must not resolve to a DOTS coefficient.
    sex: isSex(raw.sex) ? raw.sex : null,
    units: isUnits(raw.units) ? raw.units : DEFAULT_UNITS,
  };
}

/** The profile, or null when there is not one yet. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!userId) return null;
  const { tables, databaseId } = browserAppwrite();
  try {
    const row = await tables.getRow({ databaseId, tableId: "profiles", rowId: userId });
    return toProfile(row as unknown as ProfileRow);
  } catch {
    // A missing row is the normal answer for an account that predates this
    // ticket, not an error worth surfacing.
    return null;
  }
}

/**
 * Makes sure this person has a profile, and returns it.
 *
 * Idempotent and memoised per page load, the same shape as `ensureMyCircle` and
 * for the same reason: an athlete without one is invisible to their coach.
 * `fetchAthleteNames` reads this table, so until a row exists the coach's rail
 * and every name in the Review Queue are blank -- which is exactly the state
 * the product was in before this ticket, because nothing ever called
 * `createProfile`.
 *
 * Seeded from the Appwrite account rather than asking, so an existing account
 * and a Google sign-in both get one without a form standing between an athlete
 * and their first session. Sex is left unanswered; the screen asks.
 */
let pending: Promise<Profile | null> | null = null;

async function ensure(): Promise<Profile | null> {
  const { account } = browserAppwrite();
  const user = await account.get();

  const existing = await fetchProfile(user.$id);
  if (existing) return existing;

  const displayName = fallbackName(user.name ?? "", user.email ?? "");
  const actor: Actor = { userId: user.$id };
  try {
    await createProfile(browserWriteDeps(() => user.$id), actor, {
      displayName,
      units: DEFAULT_UNITS,
    });
  } catch {
    // Two tabs opening at once race here, and the loser sees a duplicate-id
    // error. Re-reading settles it: whichever won, there is a row now.
    return fetchProfile(user.$id);
  }
  return { userId: user.$id, displayName, sex: null, units: DEFAULT_UNITS };
}

export function ensureMyProfile(): Promise<Profile | null> {
  pending ??= ensure().catch((error) => {
    // Never cache a failure, or one bad moment on a train leaves this account
    // nameless for the rest of the page's life.
    pending = null;
    throw error;
  });
  return pending;
}

/** Test seam, and used on sign-out so the next account starts clean. */
export function forgetProfile(): void {
  pending = null;
}

export interface ProfileEdit {
  displayName?: string;
  sex?: Sex;
  units?: Units;
}

/** Saves a change. Only the fields given are written. */
export async function saveProfile(userId: string, edit: ProfileEdit): Promise<void> {
  await updateProfile(browserWriteDeps(() => userId), { userId }, edit);
  // The memo holds a stale copy now; the next reader should go and look.
  forgetProfile();
}
