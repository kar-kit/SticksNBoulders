"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { currentUser } from "./session";
import { fetchCoachStatus, NOT_A_COACH, type CoachStatus } from "./role";

/**
 * The signed-in athlete, fetched once per app load rather than per screen.
 *
 * Sessions are long and refreshed silently. An athlete signed out mid-workout
 * stops, fails to sign in one-handed, and opens Strong instead -- so nothing
 * here ever forces a re-check during a session.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: SessionUser; coach: CoachStatus };

const SessionContext = createContext<{ state: SessionState; refresh: () => Promise<void> } | null>(null);

/** Resolves the session. No React in here, so it is testable on its own. */
async function resolveSession(): Promise<SessionState> {
  const result = await currentUser();
  if (!result.ok) return { status: "signed-out" };

  const user = { id: result.value.$id, name: result.value.name, email: result.value.email };
  // A failed link lookup must not lock someone out of their own app. They are
  // treated as not a coach until it succeeds.
  const coach = await fetchCoachStatus(user.id).catch(() => NOT_A_COACH);
  return { status: "signed-in", user, coach };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    // The await sits inside the effect rather than behind a useCallback so the
    // setState is visibly asynchronous, and so a provider unmounted mid-flight
    // does not set state afterwards.
    void (async () => {
      const next = await resolveSession();
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      state,
      /**
       * Awaited by callers that are about to navigate -- signing in, signing
       * out -- so the next screen never reads a stale session and bounce them
       * straight back.
       */
      refresh: async () => {
        setState(await resolveSession());
      },
    }),
    [state],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside a SessionProvider");
  return context;
}

/**
 * Sends a signed-out visitor to sign-in and renders nothing meanwhile.
 *
 * Deliberately no spinner: the check resolves in milliseconds from a local
 * session, and a flash of spinner on every navigation reads as slowness --
 * which is the single complaint this product exists to answer.
 */
export function useRequireSession(): SessionState {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "signed-out") router.replace("/sign-in");
  }, [state.status, router]);

  return state;
}
