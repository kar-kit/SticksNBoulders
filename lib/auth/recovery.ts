import type { AuthFailure } from "./errors";

/**
 * Password recovery, as state rather than as screens.
 *
 * The rule that shapes all of it: the "we've sent it" screen must say the same
 * thing whether or not the address has an account.
 *
 * [Fact, verified against the live instance once SMTP was enabled] Appwrite's
 * createRecovery returns 200 for a known address and **404 user_not_found for
 * an unknown one**. The two are trivially distinguishable, so a screen that
 * branched on the outcome would hand out an account-existence oracle -- the
 * exact thing the sign-in screen goes to some trouble to avoid.
 *
 * So the UI never reads the outcome. It cannot leak what it does not look at.
 */

/** Appwrite's recovery link is valid for one hour and works once. */
export const RECOVERY_LINK_TTL_MINUTES = 60;

/** How long before the athlete may ask for another email. */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface ResetTokenParams {
  userId: string;
  secret: string;
}

/**
 * Appwrite appends userId and secret to the redirect URL. Anything missing or
 * malformed means a mangled link -- a mail client that broke it across lines,
 * or someone opening the reset page directly.
 */
export function parseResetParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ResetTokenParams | null {
  const get = (key: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const userId = get("userId")?.trim();
  const secret = get("secret")?.trim();
  if (!userId || !secret) return null;
  return { userId, secret };
}

export type PasswordProblem = "too-short" | "mismatch" | null;

/**
 * Checked before submission so the athlete is never told a rule after the fact.
 * The design states it plainly under the field: "At least 8 characters. Nothing
 * else required." No composition rules -- they push people to weaker passwords
 * they have to write down.
 */
export function validateNewPassword(
  password: string,
  confirmation: string,
  minimumLength: number,
): PasswordProblem {
  if (password.length < minimumLength) return "too-short";
  if (password !== confirmation) return "mismatch";
  return null;
}

export function passwordProblemMessage(problem: Exclude<PasswordProblem, null>, minimumLength: number): string {
  return problem === "too-short"
    ? `At least ${minimumLength} characters.`
    : "Those two don't match.";
}

/**
 * A used or expired link. Appwrite reports both the same way, and so does this:
 * either way the answer is to request a fresh one.
 */
export function isSpentToken(failure: AuthFailure): boolean {
  return failure.kind === "invalid-credentials" || failure.kind === "unknown";
}

/** Counts down the resend cooldown. Returns 0 once it is up. */
export function remainingCooldown(startedAt: number, now: number, seconds = RESEND_COOLDOWN_SECONDS): number {
  const elapsed = Math.floor((now - startedAt) / 1000);
  return Math.max(0, seconds - elapsed);
}

export function formatCooldown(secondsLeft: number): string {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Remembering which address asked for the reset.
 *
 * Appwrite's docs say the recovery link carries the email in the query string,
 * but the SDK only documents userId and secret, and that cannot be confirmed
 * without a real delivered email. So the address is also stashed when the link
 * is requested, and the reset screen takes whichever source it can get.
 *
 * It is only ever used to say "Signed in as ..." and to sign the athlete in
 * afterwards. When neither source has it, the reset still works and they land
 * on sign-in instead -- a worse ending, not a broken one.
 */
const RESET_EMAIL_KEY = "snb.reset-email";

export function rememberResetEmail(email: string, storage?: Storage): void {
  try {
    (storage ?? sessionStorage).setItem(RESET_EMAIL_KEY, email);
  } catch {
    // Private browsing, blocked storage. Not worth failing a reset over.
  }
}

export function recallResetEmail(storage?: Storage): string | null {
  try {
    return (storage ?? sessionStorage).getItem(RESET_EMAIL_KEY);
  } catch {
    return null;
  }
}

export function forgetResetEmail(storage?: Storage): void {
  try {
    (storage ?? sessionStorage).removeItem(RESET_EMAIL_KEY);
  } catch {
    // As above.
  }
}
