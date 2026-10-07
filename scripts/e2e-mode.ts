import type { Users } from "node-appwrite";
import { withMode, type Mode } from "../lib/auth/mode";

/**
 * Answers the first-run question for a throwaway user, as the welcome screen
 * would have.
 *
 * Since the welcome screen (docs/onboarding.md), an account with no mode and
 * no athletes lands on /welcome rather than /today. These scripts test what
 * comes after that question, so their users arrive having answered it --
 * e2e-auth is the one that walks through the screen itself. Written with the
 * same merge the app uses, so the prefs look exactly like a real answer.
 */
export async function presetMode<T extends { $id: string }>(users: Users, user: T, mode: Mode): Promise<T> {
  await users.updatePrefs({ userId: user.$id, prefs: withMode({}, mode) });
  return user;
}
