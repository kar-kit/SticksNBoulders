"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { avatarOf, createProfile, isAuthentic, updateProfile, type Actor } from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import { rememberAvatars } from "./avatar-cache";
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
 * so an athlete can only ever write their own *correctly stamped* profile --
 * Appwrite refuses a row stamped for somebody else. What it does not refuse is
 * a row at somebody else's id stamped readable by every signed-in user, a role every session
 * holds, which is how a stranger could squat a new user's profile before they
 * onboard (docs/permission-audit.md, 27 Sep 2026). So `fetchProfile` only
 * trusts a row its own user wrote, and the validate-row Function deletes a
 * squat within seconds of it landing.
 */

interface ProfileRow {
  $id: string;
  user_id?: unknown;
  display_name?: unknown;
  sex?: unknown;
  units?: unknown;
  avatar_file_id?: unknown;
}

function toProfile(raw: ProfileRow): Profile {
  return {
    userId: typeof raw.user_id === "string" ? raw.user_id : raw.$id,
    displayName: typeof raw.display_name === "string" ? raw.display_name : "",
    // Anything that is not one of the two known values reads as unanswered.
    // A profile carrying a third value must not resolve to a DOTS coefficient.
    sex: isSex(raw.sex) ? raw.sex : null,
    units: isUnits(raw.units) ? raw.units : DEFAULT_UNITS,
    // Only a picture in the owner's own namespace; see appwrite/documents/avatar.ts.
    avatarFileId: avatarOf(raw as unknown as Record<string, unknown>),
  };
}

/** The profile, or null when there is not one yet. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!userId) return null;
  const { tables, databaseId } = browserAppwrite();
  try {
    const row = await tables.getRow({ databaseId, tableId: "profiles", rowId: userId });
    // A row at this id that this user did not write is a squat: somebody
    // created it, stamped for everyone, before the user onboarded. Read as
    // absent, so `ensure` writes the real one once the validate-row Function
    // has removed it (appwrite/documents/provenance.ts).
    if (!isAuthentic("profiles", row as unknown as Record<string, unknown>)) return null;
    const profile = toProfile(row as unknown as ProfileRow);
    rememberAvatars([[profile.userId, profile.avatarFileId]]);
    return profile;
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
  // The row carries a read for this user's circle, and Appwrite refuses a
  // `team:` role from a session that is not in the team. The offline runner
  // ensured the circle before calling this; the Me screen and the welcome
  // screen did not, so an account that had never logged a set could not get a
  // profile from either. Memoised, so the runner's path pays nothing extra.
  await ensureMyCircle();
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
  return { userId: user.$id, displayName, sex: null, units: DEFAULT_UNITS, avatarFileId: null };
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

/**
 * The welcome screen's write: a profile exists, under the name they gave.
 *
 * Idempotent like `ensureMyProfile`, and for the same reason it exists at all:
 * a profile row is what makes someone a name rather than "Unnamed athlete" to
 * a coach, so it is written at minute one rather than at the first set.
 *
 * An existing row keeps its name unless they changed the field. The field is
 * pre-filled from the row when the row could be read in time, and from the
 * account name when it could not -- and that guess, submitted untouched, must
 * not overwrite a name somebody already chose on the Me screen.
 */
export async function claimMyProfile(name: string, edited: boolean): Promise<Profile> {
  const { account } = browserAppwrite();
  const user = await account.get();
  const actor: Actor = { userId: user.$id };
  const deps = browserWriteDeps(() => user.$id);

  const rename = async (profile: Profile): Promise<Profile> => {
    if (!edited || profile.displayName === name) return profile;
    await updateProfile(deps, actor, { displayName: name });
    return { ...profile, displayName: name };
  };

  await ensureMyCircle();
  const existing = await fetchProfile(user.$id);
  let claimed: Profile;
  if (existing) {
    claimed = await rename(existing);
  } else {
    try {
      await createProfile(deps, actor, { displayName: name, units: DEFAULT_UNITS });
      claimed = { userId: user.$id, displayName: name, sex: null, units: DEFAULT_UNITS, avatarFileId: null };
    } catch (error) {
      // Lost a race with `ensureMyProfile` -- a queued set flushing in the
      // same second. Whichever won, there is a row now; treat it as existing.
      const raced = await fetchProfile(user.$id);
      if (!raced) throw error;
      claimed = await rename(raced);
    }
  }
  // The memo may hold the fallback-named copy from before.
  forgetProfile();
  return claimed;
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
