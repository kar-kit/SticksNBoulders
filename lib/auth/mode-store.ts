"use client";

import { browserAppwrite } from "@/appwrite/browser-client";
import { readModePrefs, withMode, type Mode, type ModePrefs } from "./mode";

/**
 * Saving the landing mode to the account's prefs.
 *
 * Read, merge, write, because `updatePrefs` replaces the whole object. The read
 * is fresh rather than taken from the session: another tab, or another device,
 * may have written since this page loaded, and merging into a stale copy would
 * quietly undo it. Two writes racing can still lose one; for a preference that
 * is rewritten on the next shell mount anyway, that is an acceptable loss.
 */
export async function saveMode(mode: Mode): Promise<ModePrefs> {
  const { account } = browserAppwrite();
  const current = await account.getPrefs();
  const next = withMode(current, mode);
  await account.updatePrefs({ prefs: next });
  return readModePrefs(next);
}
