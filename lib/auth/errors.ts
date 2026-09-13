/**
 * Turning Appwrite's auth errors into the states the Sign In blueprint names.
 *
 * The load-bearing fact, verified against the live instance: a wrong password,
 * an account that has no password because it was created through Google, and
 * an email nobody has registered all return the SAME
 * `401 user_invalid_credentials`. The client cannot tell them apart, which is
 * why "You signed up with Google" needs the server hint rather than an error
 * code.
 */

export type AuthFailure =
  /** Wrong password, no such account, or an account with no password set. */
  | { kind: "invalid-credentials" }
  /** Established by the server hint, never by an error code. */
  | { kind: "other-method"; provider: OAuthProviderName }
  /**
   * The server knows the account has no password but cannot name the provider
   * -- no readable identity. Still worth saying: offering a reset here sends
   * someone to an email for an account with no password to reset.
   */
  | { kind: "other-method-unknown" }
  | { kind: "email-taken" }
  | { kind: "weak-password"; minimumLength: number }
  | { kind: "rate-limited" }
  /** Authentication is the one thing that genuinely cannot work offline. */
  | { kind: "offline" }
  | { kind: "unknown"; message: string };

export type OAuthProviderName = "google" | "apple";

/** Appwrite's minimum. Shown before submission, never as an error afterwards. */
export const MINIMUM_PASSWORD_LENGTH = 8;

interface AppwriteLikeError {
  code?: number;
  type?: string;
  message?: string;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function toAuthFailure(error: unknown): AuthFailure {
  if (isOffline()) return { kind: "offline" };

  const e = error as AppwriteLikeError;

  // A fetch that never reached Appwrite. The browser reports this as a
  // TypeError, and it is far more often a dead gym connection than a bug.
  if (error instanceof TypeError || (e?.message ?? "").includes("Failed to fetch")) {
    return { kind: "offline" };
  }

  switch (e?.type) {
    case "user_invalid_credentials":
      return { kind: "invalid-credentials" };
    case "user_already_exists":
      return { kind: "email-taken" };
    case "password_personal_data":
    case "general_argument_invalid":
      // Appwrite rejects a password shorter than 8, or one containing the
      // user's own email. Both are the same fix for the person typing.
      return { kind: "weak-password", minimumLength: MINIMUM_PASSWORD_LENGTH };
    case "general_rate_limit_exceeded":
      return { kind: "rate-limited" };
    default:
      break;
  }

  if (e?.code === 429) return { kind: "rate-limited" };
  if (e?.code === 401) return { kind: "invalid-credentials" };

  return { kind: "unknown", message: e?.message ?? "Something went wrong. Try again." };
}

/**
 * The message shown under the field. Never a toast: a toast disappears while
 * someone is still reading it, and this is the screen where they are already
 * frustrated.
 */
export function failureMessage(failure: AuthFailure): string {
  switch (failure.kind) {
    case "invalid-credentials":
      // Deliberately says nothing about whether the email exists.
      return "That email and password don't match.";
    case "other-method":
      return failure.provider === "google"
        ? "You signed up with Google. Continue with Google."
        : "You signed up with Apple. Continue with Apple.";
    case "other-method-unknown":
      return "That account doesn't use a password. Use one of the options above.";
    case "email-taken":
      return "There's already an account with that email.";
    case "weak-password":
      return `Passwords need at least ${failure.minimumLength} characters.`;
    case "rate-limited":
      return "Too many attempts. Wait a minute and try again.";
    case "offline":
      return "You're offline. Signing in needs a connection.";
    case "unknown":
      return failure.message;
  }
}

/** Whether to offer the reset link beside the message. */
export function offersPasswordReset(failure: AuthFailure): boolean {
  return failure.kind === "invalid-credentials";
}

/** Whether to surface the provider button beside the message. */
export function offersProvider(failure: AuthFailure): OAuthProviderName | null {
  return failure.kind === "other-method" ? failure.provider : null;
}
