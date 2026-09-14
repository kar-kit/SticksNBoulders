"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { failureMessage, MINIMUM_PASSWORD_LENGTH } from "@/lib/auth/errors";
import { completePasswordReset, signInWithPassword } from "@/lib/auth/session";
import {
  forgetResetEmail,
  isSpentToken,
  recallResetEmail,
  passwordProblemMessage,
  validateNewPassword,
  type ResetTokenParams,
} from "@/lib/auth/recovery";

export interface ResetFormProps {
  token: ResetTokenParams;
  /** Shown so the athlete knows which account they are changing. */
  email?: string;
  destination: string;
}

/** sessionStorage never changes during this page's life, so nothing to watch. */
const noSubscribe = () => () => {};

export function ResetForm({ token, email: emailFromLink, destination }: ResetFormProps) {
  const router = useRouter();

  // Read through useSyncExternalStore rather than an effect: storage is
  // client-only, and setting state from an effect both trips the cascading
  // render rule and renders the wrong copy for a frame. The server snapshot is
  // null, so the server and the first client render agree.
  const getStored = useCallback(() => (emailFromLink ? null : recallResetEmail()), [emailFromLink]);
  const stored = useSyncExternalStore(noSubscribe, getStored, () => null);
  const email = emailFromLink ?? stored ?? undefined;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const problem = validateNewPassword(password, confirmation, MINIMUM_PASSWORD_LENGTH);
    if (problem) {
      setError(passwordProblemMessage(problem, MINIMUM_PASSWORD_LENGTH));
      return;
    }

    setBusy(true);
    setError(null);
    const result = await completePasswordReset(token.userId, token.secret, password);

    if (!result.ok) {
      // A used or expired link is not something a message can fix, so the
      // screen changes rather than nagging.
      if (isSpentToken(result.failure)) setSpent(true);
      else setError(failureMessage(result.failure));
      setBusy(false);
      return;
    }

    // "Signed in as ... once this is saved." Making someone retype the password
    // they just chose, on the screen where they chose it, is friction for
    // nothing.
    forgetResetEmail();
    if (email) await signInWithPassword(email, password);
    router.replace(email ? destination : "/sign-in");
  }

  if (spent) {
    return (
      <main className="flex min-h-dvh flex-col justify-center px-6">
        <EmptyState
          title="That link has expired"
          body="Reset links work once and last an hour. Ask for a new one and it will be with you in a moment."
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

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-6 px-6 py-6">
      <header className="flex flex-col items-center gap-3.5">
        <Image src="/mark-transparent.png" alt="" width={80} height={80} priority className="size-20 object-contain" />
        <span className="text-wordmark font-semibold tracking-[0.01em]">Sticks N Boulders</span>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-value-lg font-semibold tracking-[-0.01em]">Choose a new password</h1>
        <p className="m-0 text-body text-muted">
          {email ? `Signed in as ${email} once this is saved.` : "You'll sign in with it next time."}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalid={Boolean(error)}
          hint={`At least ${MINIMUM_PASSWORD_LENGTH} characters. Nothing else required.`}
        />
        <PasswordField
          label="Confirm"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          invalid={Boolean(error)}
        />
        {error ? (
          <p role="alert" className="m-0 text-ui leading-snug text-foreground">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="xl" block disabled={busy}>
          Save and sign in
        </Button>
      </form>
    </main>
  );
}
