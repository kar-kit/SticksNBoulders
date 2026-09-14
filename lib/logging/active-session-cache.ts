import type { SessionRecord } from "./session";

/**
 * The running session, remembered across a cold start.
 *
 * Narrow on purpose. The queue already covers a session that has never synced;
 * this covers the one that synced at the gym door and then could not be read
 * back because the phone reloaded in a basement. Without it that athlete sees
 * no session running, starts a second one, and ends the day with their work
 * split across two rows that nothing will ever join.
 *
 * Deliberately not a general read cache. One record, written on start, cleared
 * on finish. History and rollups still come from Appwrite, because a stale
 * number in a training log is worse than a slow one.
 */

const KEY = "snb.active-session";

/**
 * How long a remembered session is still believable.
 *
 * Nobody trains for twelve hours. The record is cleared on finish, but a finish
 * that never ran -- the app killed, storage refusing a write -- would otherwise
 * leave a session that looks live forever and quietly prevents starting a new
 * one. Expiring it costs a stale session on the History screen; not expiring it
 * costs an athlete who cannot start training.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Stored {
  id: string;
  clientSessionId: string;
  startedAt: string;
  athleteId: string;
}

/** Storage can throw -- private mode, a full quota -- and never for a reason worth failing a workout over. */
function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function rememberActiveSession(athleteId: string, session: SessionRecord): void {
  safely(() => {
    const stored: Stored = {
      id: session.id,
      clientSessionId: session.clientSessionId,
      startedAt: session.startedAt.toISOString(),
      athleteId,
    };
    localStorage.setItem(KEY, JSON.stringify(stored));
  }, undefined);
}

export function forgetActiveSession(): void {
  safely(() => localStorage.removeItem(KEY), undefined);
}

/** The remembered session, if it belongs to this athlete and still parses. */
export function recallActiveSession(athleteId: string, now: Date = new Date()): SessionRecord | null {
  return safely(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.athleteId !== athleteId || !stored.id || !stored.startedAt) return null;
    const startedAt = new Date(stored.startedAt);
    if (Number.isNaN(startedAt.getTime())) return null;
    if (now.getTime() - startedAt.getTime() > MAX_AGE_MS) return null;
    return {
      id: stored.id,
      clientSessionId: stored.clientSessionId ?? stored.id,
      startedAt,
      finishedAt: null,
      // Totals are whatever the sets say once they load. Storing a stale count
      // here would put a wrong number on the finish screen.
      setCount: 0,
      tonnageKg: 0,
      notes: null,
    } satisfies SessionRecord;
  }, null);
}
