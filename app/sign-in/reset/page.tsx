import Link from "next/link";
import { AFTER_SIGN_IN } from "@/lib/auth/destinations";
import { EmptyState } from "@/components/ui/empty-state";
import { parseResetParams } from "@/lib/auth/recovery";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password — Sticks N Boulders" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/sign-in/reset">) {
  const params = await searchParams;
  const token = parseResetParams(params);

  // Someone opened this page directly, or a mail client mangled the link
  // across a line break. Either way there is nothing to reset.
  if (!token) {
    return (
      <main className="flex min-h-dvh flex-col justify-center px-6">
        <EmptyState
          title="This link is incomplete"
          body="Reset links sometimes get broken up by email apps. Ask for a fresh one and open it in a single tap."
          action={
            <Link
              href="/sign-in/forgot"
              className="inline-flex h-11 items-center rounded-control bg-accent-fill px-[18px] text-ui font-semibold text-on-accent"
            >
              Send a new link
            </Link>
          }
        />
      </main>
    );
  }

  const email = typeof params.email === "string" ? params.email : undefined;
  return <ResetForm token={token} email={email} destination={AFTER_SIGN_IN} />;
}
