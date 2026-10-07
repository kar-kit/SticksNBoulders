"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldLabel, TextField } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { homeFor, type Mode } from "@/lib/auth/mode";
import { useRequireSession, useSession } from "@/lib/auth/session-context";
import { readWelcome } from "@/lib/auth/welcome";
import { completeWelcome } from "@/lib/auth/welcome-store";
import { fallbackName } from "@/lib/profile/profile";
import { fetchProfile } from "@/lib/profile/profile-store";

/**
 * The first-run question: coach or athlete, and what to call you.
 *
 * Exists because the root could only tell a coach from an athlete by their
 * links, and a coach with no athletes yet has none -- so Ruairi's first sign-in
 * opened on an athlete's Today with no sign of a roster or an invite code.
 *
 * Asked once. The answer is a landing preference saved on the account
 * (lib/auth/mode.ts) and grants nothing; after this, the side someone last
 * used is where they open. The name is asked here so the profile row exists
 * from the first minute: an athlete who links and never logs anything is
 * otherwise "Unnamed athlete" to their coach.
 */

const CHOICES: { mode: Mode; title: string; body: string }[] = [
  {
    mode: "coach",
    title: "Coach",
    body: "Write programs and review your athletes' lifts. You can log your own training too.",
  },
  {
    mode: "athlete",
    title: "Athlete",
    body: "Log your training. Link to your coach with their invite code whenever you're ready.",
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const state = useRequireSession();
  const { refresh } = useSession();
  const nameId = useId();

  const user = state.status === "signed-in" ? state.user : null;
  const prefill = user ? fallbackName(user.name, user.email) : "";

  const [choice, setChoice] = useState<Mode | null>(null);
  // Null until typed into, so the pre-fill can still move under an untouched
  // field when the profile read lands.
  const [typed, setTyped] = useState<string | null>(null);
  const [startedFrom, setStartedFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useRef(false);

  const userId = user?.id ?? null;
  const savedMode = state.status === "signed-in" ? state.prefs.mode : null;

  // Shown once. Someone who already answered and comes back by URL goes home.
  useEffect(() => {
    if (savedMode && !saved.current) router.replace(homeFor(savedMode));
  }, [savedMode, router]);

  // A profile may already exist -- written by the Me screen, or by a set
  // logged on another device -- and its name beats a guess from the account.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchProfile(userId)
      .then((profile) => {
        if (!cancelled && profile?.displayName) setStartedFrom(profile.displayName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!user || savedMode) return <div className="min-h-dvh bg-background" aria-busy="true" />;

  const initial = startedFrom ?? prefill;
  const name = typed ?? initial;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const submission = readWelcome(choice, name, initial);
    if (!submission.ok) {
      setError(submission.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeWelcome(submission);
    } catch {
      setError("Couldn’t save that. Check your connection and try again.");
      setBusy(false);
      return;
    }
    saved.current = true;
    // Seam for the optional photo step, which lands with profile pictures:
    // after the save, before leaving, and skippable.
    await refresh();
    router.replace(homeFor(submission.mode));
  };

  return (
    <main className="pt-safe-8 flex min-h-dvh flex-col gap-7 px-6 pb-8">
      <h1 className="m-0 text-display font-semibold">How will you use Sticks N Boulders?</h1>

      <form onSubmit={submit} className="flex flex-1 flex-col gap-6" noValidate>
        <div role="radiogroup" aria-label="How you'll use it" className="flex flex-col gap-3">
          {CHOICES.map(({ mode, title, body }) => {
            const selected = choice === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setChoice(mode)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-control border bg-surface px-4 py-3.5 text-left",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                  selected ? "border-accent-line" : "border-border",
                )}
              >
                <span className="text-title font-semibold">{title}</span>
                <span className="text-ui text-muted">{body}</span>
              </button>
            );
          })}
          <p className="m-0 text-ui text-muted-2">You can switch between the two at any time.</p>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={nameId}>Your name</FieldLabel>
          <TextField
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="name"
          />
          <p className="m-0 text-ui text-muted">What your coach or your athletes will see.</p>
        </div>

        {error ? (
          <p role="alert" className="m-0 text-ui text-foreground">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="xl" block disabled={busy} className="mt-auto">
          {busy ? "Saving…" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
