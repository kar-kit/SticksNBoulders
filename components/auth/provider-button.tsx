import { cn } from "@/lib/cn";
import type { OAuthProviderName } from "@/lib/auth/errors";

/**
 * Apple and Google prescribe their own button styling, so these deliberately
 * do not use the product palette. Apple: black, white mark, "Continue with
 * Apple". Google: white, #dadce0 border, #3c4043 label, the four-colour G.
 * Restyling either to match the brand would break their guidelines, which is
 * why black and white are the only two literal colours in the codebase.
 */

function AppleMark() {
  return (
    <svg width="18" height="20" viewBox="0 0 18 20" fill="currentColor" aria-hidden="true">
      <path d="M14.94 10.63c.02-2.28 1.86-3.38 1.94-3.43-1.06-1.55-2.71-1.76-3.3-1.79-1.4-.14-2.74.83-3.45.83-.71 0-1.81-.81-2.98-.79-1.53.02-2.94.89-3.73 2.26-1.59 2.76-.41 6.85 1.14 9.09.76 1.1 1.66 2.33 2.85 2.28 1.14-.05 1.58-.74 2.96-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.22.87-1.27 1.23-2.5 1.25-2.57-.03-.01-2.4-.92-2.42-3.64zM12.7 3.9c.63-.76 1.05-1.82.94-2.88-.9.04-1.99.6-2.64 1.36-.58.67-1.09 1.75-.95 2.78 1 .08 2.02-.51 2.65-1.26z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

const STYLES: Record<OAuthProviderName, string> = {
  apple: "bg-black text-white",
  google: "bg-white text-[#3c4043] border border-[#dadce0]",
};

export interface ProviderButtonProps {
  provider: OAuthProviderName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ProviderButton({ provider, label, onClick, disabled }: ProviderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-14 w-full items-center justify-center gap-2.5 rounded-control text-title font-semibold",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        "disabled:opacity-60",
        STYLES[provider],
      )}
    >
      {provider === "apple" ? <AppleMark /> : <GoogleMark />}
      {label}
    </button>
  );
}
