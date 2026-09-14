"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRecentSessions,
  finishSessionNow,
  newClientSessionId,
  startOrRecoverSession,
} from "./session-store";
import { lastFinishedSession, pickActiveSession, type SessionRecord } from "./session";

/**
 * The athlete's training sessions, and whether one is running right now.
 *
 * Today and Log Session both need the same answer -- is a session live, and
 * which -- so it is resolved once for the athlete surface rather than twice.
 * Same shape as SessionProvider and ExerciseLibraryProvider; the persistent
 * cache that would replace all three arrives with IndexedDB at Order 9.
 */

export type TrainingState =
  | { status: "loading"; sessions: SessionRecord[] }
  | { status: "ready"; sessions: SessionRecord[] }
  | { status: "failed"; sessions: SessionRecord[] };

interface TrainingValue {
  state: TrainingState;
  /** The session to resume, or null. */
  active: SessionRecord | null;
  lastFinished: SessionRecord | null;
  /** Starts one, or hands back the one already running. */
  start: () => Promise<SessionRecord>;
  finish: (sessionId: string, totals: { setCount: number; tonnageKg: number }) => Promise<void>;
  reload: () => Promise<void>;
}

const TrainingContext = createContext<TrainingValue | null>(null);

async function resolveSessions(
  athleteId: string | null,
  load: (athleteId: string) => Promise<SessionRecord[]>,
  previous: SessionRecord[],
): Promise<TrainingState> {
  if (!athleteId) return { status: "ready", sessions: [] };
  try {
    return { status: "ready", sessions: await load(athleteId) };
  } catch {
    // A failed read must not stop someone training. They keep whatever was
    // already on screen, and starting a session is still allowed to try.
    return { status: "failed", sessions: previous };
  }
}

export function TrainingSessionProvider({
  athleteId,
  children,
  load = fetchRecentSessions,
  start: startSession = startOrRecoverSession,
  finish: finishSessionCall = finishSessionNow,
}: {
  athleteId: string | null;
  children: React.ReactNode;
  load?: (athleteId: string) => Promise<SessionRecord[]>;
  start?: typeof startOrRecoverSession;
  finish?: typeof finishSessionNow;
}) {
  const [state, setState] = useState<TrainingState>({ status: "loading", sessions: [] });
  /**
   * Held across retries on purpose. client_session_id is unique-indexed, so
   * reusing it is what makes a second attempt recover the first attempt's
   * session instead of creating a twin.
   */
  const pendingClientId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await resolveSessions(athleteId, load, []);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, load]);

  const active = useMemo(() => pickActiveSession(state.sessions), [state.sessions]);
  const lastFinished = useMemo(() => lastFinishedSession(state.sessions), [state.sessions]);

  const reload = useCallback(async () => {
    if (!athleteId) {
      setState({ status: "ready", sessions: [] });
      return;
    }
    try {
      setState({ status: "ready", sessions: await load(athleteId) });
    } catch {
      setState((prev) => ({ status: "failed", sessions: prev.sessions }));
    }
  }, [athleteId, load]);

  const start = useCallback(async () => {
    if (active) return active;
    if (!athleteId) throw new Error("Cannot start a session without a signed-in athlete");

    pendingClientId.current ??= newClientSessionId();
    const session = await startSession({ userId: athleteId }, pendingClientId.current);
    pendingClientId.current = null;

    setState((prev) => ({
      status: "ready",
      sessions: prev.sessions.some((s) => s.id === session.id)
        ? prev.sessions
        : [session, ...prev.sessions],
    }));
    return session;
  }, [active, athleteId, startSession]);

  const finish = useCallback(
    async (sessionId: string, totals: { setCount: number; tonnageKg: number }) => {
      if (!athleteId) throw new Error("Cannot finish a session without a signed-in athlete");
      const finishedAt = new Date();
      await finishSessionCall({ userId: athleteId }, sessionId, totals, finishedAt);
      setState((prev) => ({
        status: "ready",
        sessions: prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, finishedAt, setCount: totals.setCount, tonnageKg: totals.tonnageKg } : s,
        ),
      }));
    },
    [athleteId, finishSessionCall],
  );

  const value = useMemo<TrainingValue>(
    () => ({ state, active, lastFinished, start, finish, reload }),
    [state, active, lastFinished, start, finish, reload],
  );

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
}

export function useTrainingSessions() {
  const context = useContext(TrainingContext);
  if (!context) throw new Error("useTrainingSessions must be used inside a TrainingSessionProvider");
  return context;
}
