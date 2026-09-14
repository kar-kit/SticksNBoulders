import { SignInForm } from "./sign-in-form";
import { AFTER_SIGN_IN } from "@/lib/auth/destinations";
import { enabledProviders } from "@/lib/auth/providers";

export const metadata = { title: "Sign in — Sticks N Boulders" };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <SignInForm
        // Apple is built but hidden until the Services ID exists; see
        // lib/auth/providers.ts for why it is not mandatory for a PWA.
        providers={enabledProviders({ appleEnabled: process.env.NEXT_PUBLIC_APPWRITE_APPLE_ENABLED })}
        destination={AFTER_SIGN_IN}
      />
    </main>
  );
}
