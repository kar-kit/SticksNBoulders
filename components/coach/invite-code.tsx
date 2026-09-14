"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/session-context";
import { fetchMyInviteCode, mintInviteCode } from "@/lib/coach/invite-store";

/**
 * A coach's invite code: the one thing standing between Ruairi's empty account
 * and his first athlete.
 *
 * Shown to everybody, not only to someone the app already considers a coach.
 * Role is a relationship -- `isCoach` is true because athletes are linked to
 * you -- so gating this on it would mean a coach with no athletes never sees
 * the code that gets them their first one. An athlete who never taps the
 * button never has a code, and nothing about their account changes.
 *
 * The code is generated on demand rather than at sign-up for the same reason:
 * there is no moment in onboarding where the app knows which kind of user it
 * is talking to, and inventing one would be inventing an account type.
 */

const COPIED_MS = 2_000;

type State =
  | { status: "loading" }
  | { status: "none" }
  | { status: "minting" }
  | { status: "ready"; code: string }
  | { status: "failed" };

export interface InviteCodePanelProps {
  /**
   * Draws the COACHING section label. Off on the Roster, where the whole
   * screen is already about coaching and the heading only repeats it.
   */
  labelled?: boolean;
}

export function InviteCodePanel({ labelled = true }: InviteCodePanelProps) {
  const { state: session } = useSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  const coachId = session.status === "signed-in" ? session.user.id : null;
  const athletes = session.status === "signed-in" ? session.coach.athleteIds.length : 0;

  useEffect(() => {
    if (!coachId) return;
    let cancelled = false;
    void (async () => {
      // A read that cannot reach Appwrite is a coach with no signal, not a
      // coach with no code. Treated as "none" either way: the button is the
      // same button, and tapping it returns the code they already have.
      const code = await fetchMyInviteCode(coachId).catch(() => null);
      if (!cancelled) setState(code ? { status: "ready", code } : { status: "none" });
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!coachId || state.status === "loading") return null;

  const mint = async () => {
    setState({ status: "minting" });
    try {
      setState({ status: "ready", code: await mintInviteCode() });
    } catch {
      setState({ status: "failed" });
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Blocked clipboard, an insecure origin, an older iOS. The code is
      // selectable text on the screen, so this is a lost convenience rather
      // than a lost code, and a toast about it would be noise.
    }
  };

  return (
    <section aria-label="Invite code" className="flex flex-col items-start gap-2">
      {labelled ? (
        <h2 className="m-0 text-caption font-semibold tracking-wide text-muted-2">COACHING</h2>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="flex items-center gap-3">
            {/* Selectable, and mono so a 5 and an S are told apart when it is
                read off a screen across a gym floor. */}
            <span className="select-all font-mono text-title font-semibold">
              {state.code}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void copy(state.code)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {/* Unlabelled means the screen around it already explains the code
              -- the Roster's empty state says exactly this -- and a second
              copy of the same sentence is noise. */}
          {labelled ? (
            <p className="m-0 text-ui text-muted">
              {athletes > 0
                ? `${athletes} athlete${athletes === 1 ? "" : "s"} linked`
                : "Send this to an athlete and they'll appear on your roster."}
            </p>
          ) : null}
          {/* Politely, and only on the change: a live region that announced the
              code itself would read it out on every render. */}
          <span aria-live="polite" className="sr-only">
            {copied ? "Invite code copied" : ""}
          </span>
        </>
      ) : (
        <>
          <Button
            variant="secondary"
            disabled={state.status === "minting"}
            onClick={() => void mint()}
          >
            {state.status === "minting" ? "Getting a code…" : "Invite an athlete"}
          </Button>
          {state.status === "failed" ? (
            <p className="m-0 text-ui text-muted">Couldn&rsquo;t reach the server. Try again.</p>
          ) : labelled ? (
            <p className="m-0 text-ui text-muted">Get a code to share with athletes you coach.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
