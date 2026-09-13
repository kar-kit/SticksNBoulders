import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Reset your password — Sticks N Boulders" };

/**
 * Password reset is FTP1-3.5. The flow needs a transactional email sender on
 * the Appwrite instance and a registered Web platform for the redirect URL,
 * neither of which exists yet -- verified: createRecovery currently fails with
 * "Register your new client as a new Web platform".
 *
 * This states that plainly rather than 404ing behind the Forgot link the
 * design puts on the sign-in screen. It is the real state of the system, not a
 * placeholder, and FTP1-3.5 replaces it with the actual reset flow.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-6">
      <EmptyState
        title="Password reset isn't set up yet"
        body="Sending reset emails needs a mail sender on the server, which is the next thing being built. Until then, ask Joey to reset it for you."
        action={
          <Link
            href="/sign-in"
            className="inline-flex h-11 items-center rounded-control bg-accent-fill px-[18px] text-ui font-semibold text-on-accent"
          >
            Back to sign in
          </Link>
        }
      />
    </main>
  );
}
