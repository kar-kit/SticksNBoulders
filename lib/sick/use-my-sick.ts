"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normaliseSickNote } from "@/appwrite/documents/sick";
import { pendingOps, type QueuedOp } from "@/lib/offline/queue";
import { subscribeToQueue } from "@/lib/offline/client";
import { addDays, localDay } from "@/lib/programming/program";
import { cachedSick, cacheSick } from "./sick-cache";
import { applyEnd, planEnd, type SickSpell } from "./sick";
import { fetchSickDays, newClientSickId } from "./sick-store";
import { queueCallInSick, queueEndSick } from "./sick-queue";

/**
 * How far back a read looks. A year covers every program day My Program is
 * likely to colour; a call-in older than that cannot change a screen anyone
 * opens.
 */
const LOOKBACK_DAYS = 366;

export interface MySick {
  /** The athlete's call-ins that have not finished before a year ago, as they stand now. */
  spells: SickSpell[];
  /**
   * Whether `spells` is the truth. False until the cache or the network has
   * answered: with nothing known, a screen must not claim a day was missed.
   */
  known: boolean;
  /** A call-in or an end is still on the device, waiting for signal. */
  pending: boolean;
  callIn: (input: { startsOn: string; endsOn: string; note: string }) => Promise<void>;
  /** "I'm better" or "never mind": today and everything after it stops being sick. */
  end: (today: string) => Promise<void>;
}

const isSickOp = (op: QueuedOp) => op.kind === "sick.create" || op.kind === "sick.end";

/**
 * The athlete's own call-ins, for Today and My Program (F31).
 *
 * Offline-first, like every write an athlete makes. A call-in or an end shows
 * at once -- on the screen and in the cache -- and goes down the offline queue
 * behind it. The network read lands over the top of that only when nothing is
 * still queued, so a read that started before a tap cannot undo it, and one
 * more read runs when the queue empties, because the server then has the
 * change.
 */
export function useMySick(athleteId: string | null): MySick {
  const [state, setState] = useState<{ for: string | null; spells: SickSpell[]; known: boolean }>({
    for: null,
    spells: [],
    known: false,
  });
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const spellsRef = useRef<SickSpell[]>([]);
  const [refetch, setRefetch] = useState(0);

  const show = useCallback(
    (forAthlete: string, spells: SickSpell[]) => {
      spellsRef.current = spells;
      cacheSick(forAthlete, spells);
      setState({ for: forAthlete, spells, known: true });
    },
    [],
  );

  // The queue: whether a sick op is waiting, and a fresh read when it empties.
  useEffect(() => {
    let was = false;
    return subscribeToQueue((ops) => {
      const waiting = pendingOps(ops).some(isSickOp);
      pendingRef.current = waiting;
      setPending(waiting);
      if (was && !waiting) setRefetch((n) => n + 1);
      was = waiting;
    });
  }, []);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void (async () => {
      // Behind an await so every update is asynchronous, as in use-my-program.
      await Promise.resolve();
      const cached = cachedSick(athleteId);
      if (cached && !cancelled) {
        spellsRef.current = cached;
        setState({ for: athleteId, spells: cached, known: true });
      }
      try {
        const since = addDays(localDay(), -LOOKBACK_DAYS);
        const spells = await fetchSickDays([athleteId], since);
        // Something is still on its way: what the screen shows is newer than this read.
        if (cancelled || pendingRef.current) return;
        show(athleteId, spells);
      } catch {
        // No signal. Keep what is on screen; nothing here is worth an error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, refetch, show]);

  const callIn = useCallback(
    async (input: { startsOn: string; endsOn: string; note: string }) => {
      if (!athleteId) return;
      const sickId = newClientSickId();
      const note = normaliseSickNote(input.note);
      const spell: SickSpell = {
        id: sickId,
        athleteId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        note,
        createdAt: new Date().toISOString(),
      };
      show(athleteId, [...spellsRef.current, spell]);
      await queueCallInSick({ sickId, startsOn: input.startsOn, endsOn: input.endsOn, note });
    },
    [athleteId, show],
  );

  const end = useCallback(
    async (today: string) => {
      if (!athleteId) return;
      const actions = planEnd(spellsRef.current, today);
      if (actions.length === 0) return;
      show(athleteId, applyEnd(spellsRef.current, actions));
      for (const action of actions) await queueEndSick(action.sickId, action.endsOn);
    },
    [athleteId, show],
  );

  const mine = state.for === athleteId && athleteId !== null;
  return {
    spells: mine ? state.spells : [],
    known: mine && state.known,
    pending,
    callIn,
    end,
  };
}
