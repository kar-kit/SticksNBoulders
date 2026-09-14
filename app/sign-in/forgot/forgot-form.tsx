"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth/session";
import { looksLikeEmail, normaliseEmail } from "@/lib/auth/method-hint";
import { formatCooldown, rememberResetEmail, remainingCooldown } from "@/lib/auth/recovery";

/**
 * Ask for a reset link, then the confirmation.
 *
 * The confirmation says "if that address has an account" and means it: the
 * result of the request is never inspected, so this screen cannot reveal
 * whether the address is registered even by accident.
 */
export function ForgotForm() {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const send = useCallback(async (address: string) => {
    setBusy(true);
    // So the reset screen can greet them by address and sign them in, if the
    // link is opened in this same browser.
    rememberResetEmail(normaliseEmail(address));
    // Awaited so the button stays busy, but the outcome is deliberately
    // discarded -- see the note above.
    await requestPasswordReset(address, window.location.origin);
    setSentAt(Date.now());
    setBusy(false);
  }, []);

  useEffect(() => {
    if (sentAt === null) return;
    const tick = () => setCooldown(remainingCooldown(sentAt, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const valid = looksLikeEmail(normaliseEmail(email));

  if (sentAt !== null) {
    return (
      <Screen>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-display font-semibold">Check your email</h1>
          <p className="m-0 text-body text-muted">
            If {normaliseEmail(email)} has an account, a reset link is on its way. It works once and
            expires in an hour.
          </p>
        </div>
        <Button
          size="xl"
          block
          disabled={cooldown > 0 || busy}
          onClick={() => void send(email)}
        >
          Resend link
        </Button>
        <span
          className="flex h-12 items-center justify-center font-mono text-body text-muted-2"
          aria-live="polite"
        >
          {cooldown > 0 ? `Resend in ${formatCooldown(cooldown)}` : "You can ask for another one"}
        </span>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-display font-semibold">Reset your password</h1>
        <p className="m-0 text-body text-muted">
          We&rsquo;ll email you a link. It works once and expires in an hour.
        </p>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) void send(email);
        }}
        noValidate
      >
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={emailId}>Email</FieldLabel>
          <TextField
            id={emailId}
            size="lg"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            active={valid}
          />
        </div>
        <Button type="submit" size="xl" block disabled={!valid || busy}>
          Send reset link
        </Button>
      </form>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="flex h-13 flex-none items-center gap-2.5 px-4">
        <Link href="/sign-in" className="flex items-center gap-2.5 text-action font-semibold">
          <span aria-hidden className="text-value text-muted leading-none">
            &lsaquo;
          </span>
          Back to sign in
        </Link>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-6 px-6">{children}</div>
    </main>
  );
}
