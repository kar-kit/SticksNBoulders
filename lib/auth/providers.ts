import type { OAuthProviderName } from "./errors";

/**
 * Which social buttons to render.
 *
 * Google is configured on the instance. Apple is not, and enabling it needs an
 * Apple Developer account plus a Services ID -- so it is built to the design
 * and hidden behind a flag rather than shown as a button that fails. Apple's
 * sign-in is not mandatory here: App Store Review Guideline 4.8 applies to
 * store-distributed apps, and this is a PWA with no store submission.
 */
export interface ProviderOption {
  name: OAuthProviderName;
  label: string;
}

const ALL: Record<OAuthProviderName, ProviderOption> = {
  apple: { name: "apple", label: "Continue with Apple" },
  google: { name: "google", label: "Continue with Google" },
};

export function enabledProviders(
  env: { appleEnabled?: string | boolean } = {},
): ProviderOption[] {
  const appleEnabled = env.appleEnabled === true || env.appleEnabled === "true";
  // Apple sits above Google in the design, which is Apple's own guidance.
  return appleEnabled ? [ALL.apple, ALL.google] : [ALL.google];
}
