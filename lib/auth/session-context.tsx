"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { currentUser } from "./session";
import { modeToRecord, readModePrefs, type Mode, type ModePrefs } from "./mode";
import { saveMode } from "./mode-store";
import { fetchCoachStatus, NOT_A_COACH, type CoachStatus } from "./role";
import { forgetUser, recallUser, rememberUser } from "./remembered-user";

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
  | {
      status: "signed-in";
      user: SessionUser;
      coach: CoachStatus;
      /** Which side they last used. A landing preference; grants nothing. */
      prefs: ModePrefs;
      /** Recalled from the device because Appwrite could not be reached. */
      offline: boolean;
    };

interface SessionContextValue {
  state: SessionState;
  refresh: () => Promise<void>;
  /** Best effort. Saves which side they are on; see `useRecordMode`. */
  recordMode: (mode: Mode) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Resolves the session. No React in here, so it is testable on its own. */
async function resolveSession(): Promise<SessionState> {
  const result = await currentUser();
  if (!result.ok) {
    // Told no is different from not being able to ask. A request that never
    // reached Appwrite means a gym with no signal, and bouncing that athlete to
    // a sign-in screen they cannot use -- mid-session, with sets queued on the
    // device -- is the exact failure the offline queue exists to prevent.
    if (result.failure.kind === "offline") {
      const remembered = recallUser();
      if (remembered) return { status: "signed-in", ...remembered, offline: true };
    }
    forgetUser();
    return { status: "signed-out" };
  }

  const user = { id: result.value.$id, name: result.value.name, email: result.value.email };
  // Prefs arrive on the same `account.get()`, so the landing mode costs no
  // request of its own.
  const prefs = readModePrefs(result.value.prefs);
  // A failed link lookup must not lock someone out of their own app. They are
  // treated as not a coach until it succeeds.
  const coach = await fetchCoachStatus(user.id).catch(() => NOT_A_COACH);
  rememberUser(user, coach, prefs);
  return { status: "signed-in", user, coach, prefs, offline: false };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  // Read by `recordMode`, which has to see the latest state without being
  // re-created on every change. Written beside every setState rather than in
  // an effect: the shells call `recordMode` from their own effects, and a
  // child's effects run before its parent's, so an effect-synced ref would
  // still say "loading" at exactly the moment it is asked.
  const stateRef = useRef(state);
  const commit = useCallback((next: SessionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /**
   * Last-used wins: the shell someone is in is where they go next time.
   *
   * Applied locally first, then saved, and a failed save is swallowed -- it is
   * a preference, and nothing about navigating may wait on it or fail because
   * of it. The next shell mount tries again. Never from a remembered session:
   * there is no signal to save with, and the cached copy is not the account's.
   */
  const recordMode = useCallback(async (mode: Mode) => {
    const current = stateRef.current;
    if (current.status !== "signed-in" || current.offline) return;
    if (!modeToRecord(current.prefs, mode)) return;
    const prefs: ModePrefs = { mode, choseCoach: current.prefs.choseCoach || mode === "coach" };
    const next = { ...current, prefs };
    commit(next);
    rememberUser(next.user, next.coach, prefs);
    await saveMode(mode).catch(() => {});
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    // The await sits inside the effect rather than behind a useCallback so the
    // setState is visibly asynchronous, and so a provider unmounted mid-flight
    // does not set state afterwards.
    void (async () => {
      const next = await resolveSession();
      if (!cancelled) commit(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);

  const value = useMemo(
    () => ({
      state,
      /**
       * Awaited by callers that are about to navigate -- signing in, signing
       * out -- so the next screen never reads a stale session and bounce them
       * straight back.
       */
      refresh: async () => {
        commit(await resolveSession());
      },
      recordMode,
    }),
    [state, recordMode, commit],
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

/**
 * Records that this side of the app is the one in use.
 *
 * Mounted by the athlete layout and the coach layout rather than by the toggle
 * buttons, so a deep link into either side counts the same as a tap on the
 * switch.
 */
export function useRecordMode(shell: Mode): void {
  const { state, recordMode } = useSession();
  const signedIn = state.status === "signed-in";
  useEffect(() => {
    if (signedIn) void recordMode(shell);
  }, [signedIn, shell, recordMode]);
}
