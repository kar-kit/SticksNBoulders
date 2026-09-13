"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function SignInPage() {
  const { user, profile, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } =
    useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    router.replace(profile ? "/dashboard" : "/onboarding");
  }, [user, profile, router]);

  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "in") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 px-8 pt-safe pb-safe">
      <div className="flex flex-col items-center gap-4">
        <Image src="/mark-transparent.png" alt="" width={96} height={96} priority />
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">SticksNBoulders</h1>
          <p className="mt-1 text-sm text-muted">Bodyweight-fair lifting, among friends.</p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <button
          onClick={signInWithGoogle}
          className="flex h-12 items-center justify-center gap-3 rounded-xl bg-surface-2 text-sm font-medium text-foreground transition-colors hover:bg-border"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 10.2v3.9h5.5c-.24 1.28-1.68 3.76-5.5 3.76-3.31 0-6.02-2.74-6.02-6.11S8.19 5.64 11.5 5.64c1.89 0 3.16.8 3.89 1.49l2.65-2.56C16.36 2.9 14.18 2 11.5 2 6.36 2 2.18 6.13 2.18 11.75S6.36 21.5 11.5 21.5c6.63 0 9.13-4.66 9.13-7.06 0-.47-.05-.83-.11-1.19H12z"
            />
          </svg>
          Continue with Google
        </button>
        <button
          onClick={signInWithApple}
          className="flex h-12 items-center justify-center gap-3 rounded-xl bg-surface-2 text-sm font-medium text-foreground transition-colors hover:bg-border"
        >
          <svg width="16" height="18" viewBox="0 0 384 512" fill="currentColor">
            <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
          </svg>
          Continue with Apple
        </button>
      </div>

      <div className="flex w-full max-w-xs items-center gap-3 text-xs text-muted">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        {mode === "up" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="h-12 rounded-xl border border-border bg-surface px-4 text-sm outline-none focus:border-accent"
          />
        )}
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          className="h-12 rounded-xl border border-border bg-surface px-4 text-sm outline-none focus:border-accent"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          className="h-12 rounded-xl border border-border bg-surface px-4 text-sm outline-none focus:border-accent"
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          onClick={handleEmailSubmit}
          disabled={submitting || !email || !password}
          className="h-12 rounded-xl bg-accent text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <button
          onClick={() => {
            setMode((m) => (m === "in" ? "up" : "in"));
            setError(null);
          }}
          className="text-xs text-muted"
        >
          {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
