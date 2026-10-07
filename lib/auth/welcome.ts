import { checkDisplayName, nameRejectionMessage } from "@/lib/profile/profile";
import type { Mode } from "./mode";

/**
 * The first-run question, as a pure decision: what a submission of the welcome
 * form means, before anything is written.
 */

export type WelcomeSubmission =
  | { ok: true; mode: Mode; name: string; edited: boolean }
  | { ok: false; message: string };

/**
 * `prefill` is what the name field started with. Whether the name was edited
 * is decided on the cleaned values, so adding a trailing space to a pre-filled
 * name is not a rename.
 */
export function readWelcome(choice: Mode | null, rawName: string, prefill: string): WelcomeSubmission {
  if (!choice) return { ok: false, message: "Choose coach or athlete to carry on." };
  const checked = checkDisplayName(rawName);
  if (!checked.ok) return { ok: false, message: nameRejectionMessage(checked) };
  const before = checkDisplayName(prefill);
  return { ok: true, mode: choice, name: checked.name, edited: !before.ok || before.name !== checked.name };
}
