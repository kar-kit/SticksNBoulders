"use client";

import { claimMyProfile } from "@/lib/profile/profile-store";
import type { Mode } from "./mode";
import { saveMode } from "./mode-store";

/**
 * What submitting the welcome screen writes.
 *
 * The profile first. It is the part that matters to somebody else -- without
 * it a linked coach sees "Unnamed athlete" -- and if it fails, the mode is not
 * saved either, so the next visit to the root asks again rather than leaving a
 * mode with no profile behind it.
 *
 * Unlike the shells' last-used write, this one is not best effort: it is the
 * whole point of the screen, and a failure is shown rather than swallowed.
 */
export async function completeWelcome(input: { mode: Mode; name: string; edited: boolean }): Promise<void> {
  await claimMyProfile(input.name, input.edited);
  await saveMode(input.mode);
}
