"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ProviderButton } from "@/components/auth/provider-button";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import {
  failureMessage,
  MINIMUM_PASSWORD_LENGTH,
  offersPasswordReset,
  offersProvider,
  type AuthFailure,
  type OAuthProviderName,
} from "@/lib/auth/errors";
import { fetchMethodHint, signInWithPassword, signUpWithPassword, startOAuth } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/session-context";
import type { ProviderOption } from "@/lib/auth/providers";

export type Mode = "sign-in" | "create";

export interface SignInFormProps {
  providers: ProviderOption[];
  /** Where to land once signed in. */
  destination: string;
}

export function SignInForm({ providers, destination }: SignInFormProps) {
  const router = useRouter();
  const emailId = useId();
  const nameId = useId();

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const creating = mode === "create";
  const { state: session, refresh: refreshSession } = useSession();

  /**
   * "Already signed in -- skip this screen entirely."
   *
   * This reads the shared session rather than fetching its own. It used to call
   * account.get() directly, which meant two sources of truth: after a
   * successful sign-in the provider still held "signed-out", so the shell
   * bounced back here, this screen saw a valid session and bounced to the app,
   * and the two redirected at each other about thirty times a second.
   */
  useEffect(() => {
    if (session.status === "signed-in") router.replace(destination);
  }, [session.status, router, destination]);

  function switchMode(next: Mode) {
    setMode(next);
    // The previous mode's error does not describe this one.
    setFailure(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);

    const result = creating
      ? await signUpWithPassword(email, password, name.trim() || email.split("@")[0])
      : await signInWithPassword(email, password);

    if (result.ok) {
      // The provider is told before navigating, so the shell on the other side
      // sees a signed-in session rather than a stale one.
      await refreshSession();
      router.replace(destination);
      return;
    }

    // Appwrite cannot tell a wrong password from an account that has no
    // password, so the server is asked -- but only now, after a real attempt
    // has already failed.
    if (result.failure.kind === "invalid-credentials" && !creating) {
      const hint = await fetchMethodHint(email);
      if (hint) {
        // Either way this account has no password, so the reset link must not
        // be offered -- it would email a link for a password that does not
        // exist, and that lands as a support message on a busy coach.
        setFailure(hint === "other" ? { kind: "other-method-unknown" } : { kind: "other-method", provider: hint });
        setBusy(false);
        return;
      }
    }

    setFailure(result.failure);
    setBusy(false);
  }

  const suggestedProvider = failure ? offersProvider(failure) : null;

  return (
    <div className="flex flex-1 flex-col justify-center gap-7 px-6 pt-6">
      <header className="flex flex-col items-center gap-3.5">
        <Image src="/mark-transparent.png" alt="" width={80} height={80} priority className="size-20 object-contain" />
        <h1 className="m-0 text-wordmark font-semibold tracking-[0.01em]">Sticks N Boulders</h1>
      </header>

      {providers.length > 0 ? (
        <>
          <div className="flex flex-col gap-2.5">
            {providers.map((provider) => (
              <ProviderButton
                key={provider.name}
                provider={provider.name}
                label={provider.label}
                disabled={busy}
                onClick={() => startOAuth(provider.name, window.location.origin)}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-meta tracking-[0.08em] text-muted-2">OR</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        {creating ? (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor={nameId}>Name</FieldLabel>
            <TextField
              id={nameId}
              size="lg"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Joey Pang"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={emailId}>Email</FieldLabel>
          <TextField
            id={emailId}
            size="lg"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(failure)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>

        <PasswordField
          value={password}
          onChange={setPassword}
          invalid={Boolean(failure)}
          autoComplete={creating ? "new-password" : "current-password"}
          // Stated before submission, never thrown back as an error after it.
          hint={creating ? `At least ${MINIMUM_PASSWORD_LENGTH} characters.` : undefined}
          trailing={
            creating ? undefined : (
              <Link href="/sign-in/forgot" className="text-ui font-medium text-accent-fill">
                Forgot?
              </Link>
            )
          }
        />

        {failure ? (
          <div role="alert" className="flex flex-col gap-2.5">
            <p className="m-0 text-ui leading-snug text-foreground">
              {failureMessage(failure)}{" "}
              {offersPasswordReset(failure) ? (
                <Link href="/sign-in/forgot" className="font-semibold text-accent-fill">
                  Forgot your password?
                </Link>
              ) : null}
            </p>
            {suggestedProvider ? (
              <ProviderButton
                provider={suggestedProvider}
                label={labelFor(providers, suggestedProvider)}
                onClick={() => startOAuth(suggestedProvider, window.location.origin)}
              />
            ) : null}
          </div>
        ) : null}

        <Button type="submit" size="xl" block disabled={busy}>
          {creating ? "Create account" : "Sign in"}
        </Button>

        <div className="flex h-10 items-center justify-center gap-2">
          <span className="text-body text-muted">{creating ? "Already have an account?" : "New here?"}</span>
          <button
            type="button"
            onClick={() => switchMode(creating ? "sign-in" : "create")}
            className="text-body font-semibold text-accent-fill"
          >
            {creating ? "Sign in" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}

function labelFor(providers: ProviderOption[], name: OAuthProviderName): string {
  return providers.find((p) => p.name === name)?.label ?? `Continue with ${name}`;
}
