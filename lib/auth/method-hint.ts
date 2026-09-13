import type { OAuthProviderName } from "./errors";

/**
 * Deciding whether to tell someone their account uses a different sign-in
 * method.
 *
 * Appwrite returns one error for a wrong password, an unknown email, and an
 * account created through Google -- verified against the live instance. So the
 * only way to show the blueprint's "You signed up with Google" state is to ask
 * the server, with an API key, after the password attempt has already failed.
 *
 * That is an enumeration oracle, and it is treated as one: the answer is
 * withheld in every case except the one it exists for.
 */

export type MethodHint =
  | { hint: "none" }
  | { hint: "use-provider"; provider: OAuthProviderName }
  /** The account has no password but we cannot name the provider. */
  | { hint: "use-other-method" };

export interface DirectoryUser {
  id: string;
  /** Present when the account has a password set. */
  hasPassword: boolean;
}

export interface UserDirectory {
  findByEmail(email: string): Promise<DirectoryUser | null>;
  /** Providers this account has signed in with, e.g. ["google"]. */
  providersFor(userId: string): Promise<string[]>;
}

const KNOWN_PROVIDERS: readonly OAuthProviderName[] = ["google", "apple"];

function asProviderName(value: string): OAuthProviderName | null {
  const lower = value.toLowerCase();
  return KNOWN_PROVIDERS.find((p) => p === lower) ?? null;
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Deliberately loose. This is not validating that an address is deliverable --
 * Appwrite does that on signup -- only that a string is worth spending an
 * admin-key lookup on. "@" is not.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function resolveMethodHint(
  directory: UserDirectory,
  rawEmail: string,
): Promise<MethodHint> {
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return { hint: "none" };

  const user = await directory.findByEmail(email);

  // No account: say nothing. Confirming absence is the leak with no upside.
  if (!user) return { hint: "none" };

  // The account has a password, so the attempt was simply wrong. Revealing
  // that the address exists would tell an attacker something a failed login
  // otherwise would not.
  if (user.hasPassword) return { hint: "none" };

  // No password. The only way in is whatever they signed up with, and without
  // this hint they will loop through a reset that emails them a link for an
  // account that has no password to reset.
  const providers = await directory.providersFor(user.id);
  for (const provider of providers) {
    const name = asProviderName(provider);
    if (name) return { hint: "use-provider", provider: name };
  }

  return { hint: "use-other-method" };
}
