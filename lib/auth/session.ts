"use client";

import { OAuthProvider } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { forgetCircle } from "./circle";
import { forgetProfile } from "@/lib/profile/profile-store";
import { toAuthFailure, type AuthFailure, type OAuthProviderName } from "./errors";
import { normaliseEmail } from "./method-hint";

/**
 * Sign in, sign up, sign out.
 *
 * Sessions are deliberately long and refreshed silently. An athlete signed out
 * mid-workout stops, fails to sign in one-handed, and opens Strong instead --
 * which is the failure that empties the coach's data.
 */

export type AuthResult<T> = { ok: true; value: T } | { ok: false; failure: AuthFailure };

async function attempt<T>(fn: () => Promise<T>): Promise<AuthResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, failure: toAuthFailure(error) };
  }
}

export async function signInWithPassword(email: string, password: string) {
  const { account } = browserAppwrite();
  return attempt(() =>
    account.createEmailPasswordSession({ email: normaliseEmail(email), password }),
  );
}

export async function signUpWithPassword(email: string, password: string, name: string) {
  const { account } = browserAppwrite();
  const normalised = normaliseEmail(email);
  return attempt(async () => {
    const { ID } = await import("appwrite");
    await account.create({ userId: ID.unique(), email: normalised, password, name });
    // Straight into the app: making someone sign in again immediately after
    // creating an account is friction for nothing.
    return account.createEmailPasswordSession({ email: normalised, password });
  });
}

export async function currentUser() {
  const { account } = browserAppwrite();
  return attempt(() => account.get());
}

export async function signOut() {
  const { account } = browserAppwrite();
  // Both memos are per page load and keyed to nobody, so on a shared phone the
  // next person to sign in would inherit whatever was cached for the last.
  // `forgetCircle` has been exported for this since Order 9 and was never
  // wired up; `forgetProfile` would have had the same latent bug, and the
  // profile one is worse because it carries a name.
  forgetCircle();
  forgetProfile();
  return attempt(() => account.deleteSession({ sessionId: "current" }));
}

const PROVIDERS: Record<OAuthProviderName, OAuthProvider> = {
  google: OAuthProvider.Google,
  apple: OAuthProvider.Apple,
};

/** Leaves the page. Appwrite returns the browser to `success` or `failure`. */
export function startOAuth(provider: OAuthProviderName, origin: string) {
  const { account } = browserAppwrite();
  account.createOAuth2Session({
    provider: PROVIDERS[provider],
    success: `${origin}/today`,
    failure: `${origin}/sign-in?error=oauth`,
  });
}

/**
 * Asks Appwrite to email a reset link.
 *
 * The caller deliberately ignores whether this succeeded. Appwrite may answer
 * differently for an address with no account, and the screen that follows says
 * the same thing either way -- "if that address has an account, a link is on
 * its way" -- so the outcome is never read and therefore never leaked.
 */
export async function requestPasswordReset(email: string, origin: string) {
  const { account } = browserAppwrite();
  return attempt(() =>
    account.createRecovery({
      email: normaliseEmail(email),
      url: `${origin}/sign-in/reset`,
    }),
  );
}

/** Completes the reset with the userId and secret from the emailed link. */
export async function completePasswordReset(userId: string, secret: string, password: string) {
  const { account } = browserAppwrite();
  return attempt(() => account.updateRecovery({ userId, secret, password }));
}

/** Asks the server whether this address belongs to a provider account. */
export async function fetchMethodHint(email: string): Promise<OAuthProviderName | "other" | null> {
  try {
    const response = await fetch("/api/auth/method-hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normaliseEmail(email) }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { hint: string; provider?: string };
    if (data.hint === "use-provider" && (data.provider === "google" || data.provider === "apple")) {
      return data.provider;
    }
    if (data.hint === "use-other-method") return "other";
    return null;
  } catch {
    // The hint is an affordance, not a requirement. If it fails, the generic
    // message still stands.
    return null;
  }
}
